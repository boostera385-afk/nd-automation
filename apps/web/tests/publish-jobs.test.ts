import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const profile = "33333333-3333-4333-8333-333333333333";
const draftId = "44444444-4444-4444-8444-444444444444";
const token = "e".repeat(64);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const content = { kind: "post", title: "Authorized launch post", body: "Fixture post body", audience: "neighborhood", price_cents: null, category: null };
const releaseSmokes: Record<string, string> = {
  "202611020003_publish_scheduling.sql": "publish_scheduling_hosted_smoke.sql",
  "202611020004_automatic_sheet_mapping.sql": "automatic_sheet_mapping_hosted_smoke.sql",
  "202611020005_approved_media.sql": "approved_media_hosted_smoke.sql",
  "202611020006_browser_task_receipts.sql": "browser_task_receipts_hosted_smoke.sql",
  "202611020007_supervised_workflows.sql": "supervised_workflows_hosted_smoke.sql",
};
const smokeSql = (name: string) => readFile(new URL(`../../../supabase/tests/${name}`, import.meta.url), "utf8");
// Tests below already own a transaction/savepoint; retain only the assertions.
const smokeBody = async (name: string) => (await smokeSql(name)).replace(/^begin read only;\r?\n/m, "").replace(/^rollback;\r?$/m, "");
let org: string, customer: string, worker: string, binding: string, session: string;
async function scalar(sql: string, params: unknown[] = []) {
  return Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0])[0];
}
async function as<T>(role: "authenticated" | "anon", uid: string, run: () => Promise<T>) {
  await db.exec("savepoint pub_auth");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${uid}'`);
  try { const result = await run(); await db.exec("reset role; reset request.jwt.claim.sub; release savepoint pub_auth"); return result; }
  catch (error) { await db.exec("rollback to savepoint pub_auth; release savepoint pub_auth"); throw error; }
}
const owner = <T>(run: () => Promise<T>) => as("authenticated", user, run);
const agent = <T>(run: () => Promise<T>) => as("anon", "", run);
async function approveDraft(revision = 0) {
  await owner(() => scalar("select public.reporting_save_content_draft($1,$2,$3,$4,$5::jsonb)", [org, draftId, revision, binding, JSON.stringify(content)]));
  await owner(() => scalar("select public.reporting_review_content_draft($1,$2,$3,'approve',true)", [org, draftId, revision + 1]));
}
const enqueue = () => owner(() => scalar("select public.reporting_enqueue_publish($1,$2,$3)", [org, draftId, 2]));
type Claim = Record<string, unknown> & { job_id: string; lease_token: string };
const claim = () => agent(() => scalar("select public.reporting_claim_publish($1)", [token])) as Promise<Claim | null>;
const ok = () => ({ outcome: "submitted", reason: "Composer submitted; share link captured", adapter_sha256: "f".repeat(64), post_url: "https://nextdoor.com/p/exact-fixture-link", published_at: new Date().toISOString() });
const complete = (job: Claim, value: unknown = ok(), lease = job.lease_token) => agent(() => scalar("select public.reporting_complete_publish($1,$2,$3,$4::jsonb)", [token, job.job_id, lease, JSON.stringify(value)]));

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${user}',now()),('${other}',now());`);
  for (const file of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql", "202610270004_content_drafts.sql", "202610270006_publish_jobs.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  for (const file of ["20261029175611_sheet_writeback_v1.sql", "20261031093000_automation_tasks_v1.sql", "20261031120000_cookie_proxy_write_v1.sql", "20261031150000_inventory_scan_v1.sql", "202611020001_automation_session_gate.sql", "202611020002_publish_dispatch_guard.sql", "202611020003_publish_scheduling.sql", "202611020004_automatic_sheet_mapping.sql", "202611020005_approved_media.sql", "202611020006_browser_task_receipts.sql", "202611020007_supervised_workflows.sql"]) {
    try { await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8")); }
    catch (error) { console.error("Fixture migration failed", file, (error as { position?: string }).position); throw error; }
    if (releaseSmokes[file]) await db.exec(await smokeSql(releaseSmokes[file]));
  }
  await db.exec(await readFile(new URL("../../../supabase/proposals/protected_bulk_intake.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  org = String(await owner(() => scalar("select public.reporting_create_workspace('Publish workspace')")));
  const otherOrg = await as("authenticated", other, () => scalar("select public.reporting_create_workspace('Other workspace')"));
  customer = String(await owner(() => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Authorized customer') returning id", [org])));
  await db.query("insert into public.reporting_customers(organization_id,name) values ($1,'Other customer')", [otherOrg]);
  worker = String(await owner(() => scalar("select public.reporting_register_worker($1,'Local PC',$2)", [org, hash(token)])));
  binding = String(await owner(() => scalar("select public.reporting_bind_worker_profile($1,$2,$3,$4,'Profile A')", [org, worker, customer, profile])));
  session = String(await owner(() => scalar("select public.reporting_session_action($1,'start','America/Los_Angeles')", [org])));
  await db.exec("commit");
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

describe("ordered release catalog smokes", () => {
  it("remains compatible after later migrations without touching application rows", async () => {
    for (const name of Object.values(releaseSmokes)) await db.exec(await smokeBody(name));
    expect(await scalar("select count(*) from public.reporting_publish_jobs")).toBe(0);
    expect(await scalar("select count(*) from public.reporting_automation_tasks")).toBe(0);
  });
  it.each([
    ["publish_scheduling_hosted_smoke.sql", "grant insert on public.reporting_publish_batches to authenticated"],
    ["automatic_sheet_mapping_hosted_smoke.sql", "grant select on public.reporting_sheet_delivery_events to anon"],
    ["approved_media_hosted_smoke.sql", "grant execute on function private_reporting.valid_approved_media(jsonb) to anon"],
    ["browser_task_receipts_hosted_smoke.sql", "grant execute on function private_reporting.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text) to authenticated"],
    ["supervised_workflows_hosted_smoke.sql", "grant execute on function public.reporting_enqueue_supervised_workflow(uuid,uuid,jsonb,boolean) to anon"],
  ])("%s detects an accidental privilege expansion", async (name, grant) => {
    await db.exec("savepoint smoke_privileges");
    try {
      await db.exec(grant);
      await expect(db.exec(await smokeBody(name))).rejects.toThrow(/mismatch|exposed/);
    } finally {
      await db.exec("rollback to savepoint smoke_privileges; release savepoint smoke_privileges");
    }
  });
});

describe("protected bulk intake candidate", () => {
  const request = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const row = (changes = {}) => ({ profile_id: profile, kind: "cookie_write", replace: false, path: `C:/Private/${profile}.private.bin`, ...changes });
  const queue = (rows = [row()], permitted = true) => owner(() => scalar("select reporting_enqueue_intake_batch($1,$2,$3,$4::jsonb,$5)", [org, worker, request, JSON.stringify(rows), permitted]));
  it("records exact bindings and replays identical receipts, not mutations", async () => {
    expect(await queue()).toBe(request); expect(await queue()).toBe(request);
    expect(await scalar("select count(*) from reporting_automation_tasks where intake_batch_id=$1", [request])).toBe(1);
    expect(await scalar("select intake_customer_id from reporting_automation_tasks where intake_batch_id=$1", [request])).toBe(customer);
    await expect(queue([row({ replace: true })])).rejects.toThrow("identity conflict");
  });
  it("rejects raw fields, duplicate/unknown targets, clear-proxy and missing permission atomically", async () => {
    for (const rows of [[row({ cookie_value: "must-not-enter-db" })], [row(), row()], [row({ profile_id: "99999999-9999-4999-8999-999999999999" })], [row({ kind: "proxy_write", replace: true })], [row({ path: "C:/raw-cookies.txt" })]]) {
      await expect(queue(rows)).rejects.toThrow();
      expect(await scalar("select count(*) from reporting_intake_batches")).toBe(0);
      expect(await scalar("select count(*) from reporting_automation_tasks")).toBe(0);
    }
    await expect(queue([row()], false)).rejects.toThrow("permitted-use");
  });
  it("requires the exact active human session and denies anonymous enqueue", async () => {
    await owner(() => scalar("select reporting_session_action($1,'pause','America/Los_Angeles')", [org]));
    await expect(queue()).rejects.toThrow("active work session");
    await expect(agent(() => scalar("select reporting_enqueue_intake_batch($1,$2,$3,$4::jsonb,true)", [org, worker, request, JSON.stringify([row()])]))).rejects.toThrow("permission denied");
  });
  it("stops later rows after any failed/cancelled row even after a helper restart", async () => {
    const second = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await owner(() => scalar("select reporting_bind_worker_profile($1,$2,$3,$4,'Second profile')", [org, worker, customer, second]));
    await queue([row(), row({ profile_id: second })]);
    const task = await agent(() => scalar("select reporting_claim_automation_task($1)", [token])) as { task_id: string; lease_token: string };
    expect(task).toBeTruthy();
    await agent(() => scalar("select reporting_complete_automation_task($1,$2,$3,'failed',null,'Redacted failure')", [token, task.task_id, task.lease_token]));
    await expect(agent(() => scalar("select reporting_claim_automation_task($1)", [token]))).rejects.toThrow("stopped on failure");
    expect(await scalar("select count(*) from reporting_automation_tasks where status='pending'")).toBe(1);
  });
  it("refuses dispatch when a profile changes customer after approval", async () => {
    await queue();
    const replacement = await scalar("insert into reporting_customers(organization_id,name) values ($1,'Other authorized customer') returning id", [org]);
    await db.query("update reporting_worker_profiles set customer_id=$1 where id=$2", [replacement, binding]);
    await expect(agent(() => scalar("select reporting_claim_automation_task($1)", [token]))).rejects.toThrow("assignment changed");
  });
});

describe("enqueue guards", () => {
  it("rejects anonymous enqueue and grants staff reads only", async () => {
    await expect(as("anon", "", () => scalar("select public.reporting_enqueue_publish($1,$2,2)", [org, draftId]))).rejects.toThrow("permission denied");
    expect(await scalar("select relrowsecurity from pg_class where relname='reporting_publish_jobs'")).toBe(true);
    await expect(agent(() => scalar("select count(*) from public.reporting_publish_jobs"))).rejects.toThrow();
  });
  it("requires the current approved revision", async () => {
    await expect(enqueue()).rejects.toThrow("Only the current approved revision");
    await approveDraft();
    await expect(owner(() => scalar("select public.reporting_enqueue_publish($1,$2,1)", [org, draftId]))).rejects.toThrow("Only the current approved revision");
    expect(await enqueue()).toBeTruthy();
  });
  it("permits exactly one durable job per approved revision", async () => {
    await approveDraft(); await enqueue();
    await expect(enqueue()).rejects.toThrow("do not repost");
    expect(await scalar("select count(*) from public.reporting_publish_jobs")).toBe(1);
  });
  it("requires an active approving session", async () => {
    await approveDraft();
    await owner(() => scalar("select public.reporting_session_action($1,'end','America/Los_Angeles')", [org]));
    await expect(enqueue()).rejects.toThrow("Start an active work session first");
  });
  it("rejects unapproved, archived and returned drafts", async () => {
    await approveDraft();
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,2,'return',true)", [org, draftId]));
    await expect(owner(() => scalar("select public.reporting_enqueue_publish($1,$2,3)", [org, draftId]))).rejects.toThrow("Only the current approved revision");
  });
  it("blocks enqueue after assignment changed without re-approval", async () => {
    await approveDraft();
    const replacement = await owner(() => scalar("select public.reporting_register_worker($1,'Other PC',$2)", [org, hash("ab".repeat(32))]));
    await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
    await owner(() => scalar("select public.reporting_reassign_worker_profile($1,$2,$3)", [org, binding, replacement]));
    await expect(enqueue()).rejects.toThrow("Approved assignment changed");
  });
});

describe("durable browser-task receipts and explicit supervised workflows", () => {
  const request = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const manifest = (changes = {}) => ({ version: 1, operation: "account_inspect", binding_id: binding, profile_id: profile, customer_id: customer,
    account_label: "Profile A", account_url: "https://nextdoor.com/profile/exact-fixture", target_url: null, expected_body_sha256: null,
    draft_id: null, draft_revision: null, consent: true, ...changes });
  const queue = (value: unknown = manifest(), confirmed = false, key = request) => owner(() => scalar("select public.reporting_enqueue_supervised_workflow($1,$2,$3::jsonb,$4)", [org, key, JSON.stringify(value), confirmed]));
  const workflowClaim = () => agent(() => scalar("select public.reporting_claim_supervised_workflow($1)", [token])) as Promise<{ task_id: string; lease_token: string; payload: unknown } | null>;
  const result = (changes = {}) => ({ operation: "account_inspect", outcome: "verified", action_attempted: false, cleanup_confirmed: true,
    adapter_sha256: "a".repeat(64), observed_at: new Date().toISOString(), ...changes });
  const finish = (task: { task_id: string; lease_token: string }, value: unknown) => agent(() => scalar(
    "select public.reporting_complete_automation_task($1,$2,$3,'succeeded',$4::jsonb,null)", [token, task.task_id, task.lease_token, JSON.stringify(value)]));
  const addPost = () => owner(() => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer,
    JSON.stringify([{ title: "Exact fixture", url: "https://nextdoor.com/p/owned-fixture", account_label: "Profile A" }])]));
  it("normal agents skip supervised work and only the separate claimant leases it", async () => {
    expect(await queue()).toBe(request);
    expect(await agent(() => scalar("select public.reporting_claim_automation_task($1)", [token]))).toBeNull();
    const task = await workflowClaim(); expect(task?.payload).toEqual({ manifest: manifest(), content: null });
    expect(await workflowClaim()).toBeNull(); expect(await claim()).toBeNull();
  });
  it("replays an exact enqueue but refuses changed target under its request ID", async () => {
    await queue(); expect(await queue()).toBe(request);
    await expect(queue(manifest({ operation: "profile_browse" }))).rejects.toThrow("replay conflict");
    expect(await scalar("select count(*) from public.reporting_automation_tasks")).toBe(1);
  });
  it("only identical completion receipts replay and no cancelled lease implies delivery", async () => {
    await queue(); const task = (await workflowClaim())!; const receipt = result();
    expect(await finish(task, receipt)).toBe(true); expect(await finish(task, receipt)).toBe(false);
    await expect(finish(task, { ...receipt, outcome: "handoff_required" })).rejects.toThrow("replay conflict");
    await db.query("update public.reporting_automation_tasks set status='cancelled' where id=$1", [request]);
    await expect(finish(task, receipt)).rejects.toThrow("receipt not recorded");
  });
  it("only active verified staff can authorize and another tenant cannot read it", async () => {
    await queue();
    expect(await as("authenticated", other, () => scalar("select count(*) from public.reporting_automation_tasks"))).toBe(0);
    await expect(as("authenticated", other, () => scalar("select public.reporting_enqueue_supervised_workflow($1,$2,$3::jsonb,false)", [org, request, JSON.stringify(manifest())]))).rejects.toThrow("Verified staff");
    await expect(agent(() => scalar("select public.reporting_enqueue_supervised_workflow($1,$2,$3::jsonb,false)", [org, request, JSON.stringify(manifest())]))).rejects.toThrow("permission denied");
  });
  it.each([{ password: "PRIVATE" }, { consent: false }, { account_url: "https://elsewhere.invalid/profile/x" }, { target_url: "https://nextdoor.com/p/unrelated" }, { draft_revision: 1 }])("rejects malformed/secret manifest %#", async (changes) => {
    await expect(queue(manifest(changes))).rejects.toThrow("Invalid workflow manifest");
  });
  it("requires exact assignment and cancels when that assignment changes before claim", async () => {
    await expect(queue(manifest({ account_label: "Wrong person" }))).rejects.toThrow("Exact workflow target");
    await queue(); await db.query("update public.reporting_worker_profiles set account_label='Changed' where id=$1", [binding]);
    expect(await workflowClaim()).toBeNull(); expect(await scalar("select status from public.reporting_automation_tasks")).toBe("cancelled");
  });
  it("pauses dispatch and cannot carry an old authorization into a new work session", async () => {
    await queue(); await owner(() => scalar("select public.reporting_session_action($1,'pause','America/Los_Angeles')", [org]));
    expect(await workflowClaim()).toBeNull();
    await owner(() => scalar("select public.reporting_session_action($1,'end','America/Los_Angeles')", [org]));
    await owner(() => scalar("select public.reporting_session_action($1,'start','America/Los_Angeles')", [org]));
    expect(await workflowClaim()).toBeNull();
  });
  it("registration records handoff, cannot assert a verified new account and cannot blindly repeat", async () => {
    const input = manifest({ operation: "account_register", account_url: null });
    await queue(input); const task = (await workflowClaim())!;
    await expect(finish(task, result({ operation: "account_register", action_attempted: true }))).rejects.toThrow("human identity handoff");
    await finish(task, result({ operation: "account_register", action_attempted: true, outcome: "handoff_required" }));
    await expect(queue(input, false, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).rejects.toThrow("reconcile rather than repeat");
  });
  it("delete requires exact tracked ownership, body fingerprint and destructive confirmation", async () => {
    const input = manifest({ operation: "post_delete", target_url: "https://nextdoor.com/p/owned-fixture", expected_body_sha256: "d".repeat(64) });
    await expect(queue(input)).rejects.toThrow("destructive target");
    await expect(queue(input, true)).rejects.toThrow("Exact workflow target");
    await addPost(); expect(await queue(input, true)).toBe(request);
  });
  it("edit requires an approved exact text revision and invalidates on later changes", async () => {
    await addPost(); const input = manifest({ operation: "post_edit", target_url: "https://nextdoor.com/p/owned-fixture", expected_body_sha256: "d".repeat(64), draft_id: draftId, draft_revision: 2 });
    await expect(queue(input)).rejects.toThrow("approved text-edit");
    await approveDraft(); await queue(input);
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,2,'return',true)", [org, draftId]));
    expect(await workflowClaim()).toBeNull();
  });
  it("rejects leaked fields and forged observation times in results", async () => {
    await queue(); const task = (await workflowClaim())!;
    await expect(finish(task, result({ password: "PRIVATE" }))).rejects.toThrow("Invalid supervised");
    await expect(finish(task, result({ observed_at: "2000-01-01T00:00:00Z" }))).rejects.toThrow("outside lease");
  });
  it("does not expose private claim/receipt bypass helpers", async () => {
    for (const signature of ["private_reporting.claim_browser_task(text,boolean)", "private_reporting.reporting_claim_automation_task(text)", "private_reporting.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text)"]) {
      expect(await scalar("select has_function_privilege('anon',$1,'execute')", [signature])).toBe(false);
      expect(await scalar("select has_function_privilege('authenticated',$1,'execute')", [signature])).toBe(false);
    }
  });
});

describe("explicit bounded scheduling and bulk authorization", () => {
  const request = "77777777-7777-4777-8777-777777777777";
  const entry = () => ({ draftId, revision: 2, notBefore: new Date(Date.now() + 30 * 60000).toISOString(), windowMinutes: 10 });
  const batch = (entries: unknown, key = request) => owner(() => scalar("select public.reporting_enqueue_publish_batch($1,$2,$3::jsonb)", [org, key, JSON.stringify(entries)]));
  it("does not dispatch before due and claims exactly the approved snapshot once due", async () => {
    await approveDraft(); await batch([entry()]); expect(await claim()).toBeNull();
    await db.exec("update public.reporting_publish_jobs set not_before=clock_timestamp()-interval '1 second',dispatch_until=clock_timestamp()+interval '5 minutes'");
    expect(await claim()).toMatchObject({ draft_id: draftId, body: content.body });
  });
  it("expires missed windows without catch-up and leaves the exact revision blocked from requeue", async () => {
    await approveDraft(); await batch([entry()]);
    await db.exec("update public.reporting_publish_jobs set not_before=clock_timestamp()-interval '20 minutes',dispatch_until=clock_timestamp()-interval '1 minute'");
    expect(await claim()).toBeNull(); expect(await scalar("select status from public.reporting_publish_jobs")).toBe("cancelled");
    expect(await scalar("select failure_notes from public.reporting_publish_jobs")).toContain("no automatic catch-up");
    await expect(batch([entry()], "88888888-8888-4888-8888-888888888888")).rejects.toThrow("already exists");
  });
  it("idempotently replays the exact batch even after a result, without creating another job", async () => {
    await approveDraft(); const entries = [{ ...entry(), notBefore: null }];
    const first = await batch(entries); const job = (await claim())!; await complete(job);
    expect(await batch(entries)).toEqual(first);
    expect(await scalar("select count(*) from public.reporting_publish_jobs")).toBe(1);
  });
  it("refuses changed values under a prior request ID", async () => {
    await approveDraft(); const entries = [entry()]; await batch(entries);
    await expect(batch([{ ...entries[0], windowMinutes: 20 }])).rejects.toThrow("replay conflict");
  });
  it("bulk validation is atomic: a bad second revision queues nothing", async () => {
    await approveDraft();
    await expect(batch([entry(), { ...entry(), draftId: "88888888-8888-4888-8888-888888888888" }])).rejects.toThrow("approved revision");
    expect(await scalar("select count(*) from public.reporting_publish_jobs")).toBe(0);
    expect(await scalar("select count(*) from public.reporting_publish_batches")).toBe(0);
  });
  it("queues two separately approved immutable revisions without dispatching either before due", async () => {
    await approveDraft(); const second = "88888888-8888-4888-8888-888888888888";
    await owner(() => scalar("select public.reporting_save_content_draft($1,$2,0,$3,$4::jsonb)", [org, second, binding, JSON.stringify({ ...content, title: "Second authorized draft" })]));
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,1,'approve',true)", [org, second]));
    const result = await batch([entry(), { ...entry(), draftId: second }]) as unknown[];
    expect(result).toHaveLength(2); expect(await claim()).toBeNull();
    expect(await scalar("select count(*) from public.reporting_publish_jobs where status='pending'")).toBe(2);
  });
  it("rejects duplicate drafts and bounds batches without partial mutations", async () => {
    await approveDraft();
    await expect(batch([entry(), entry()])).rejects.toThrow("Duplicate draft");
    await expect(batch(Array.from({ length: 21 }, entry))).rejects.toThrow("Invalid publish batch");
    await expect(batch([])).rejects.toThrow("Invalid publish batch");
    expect(await scalar("select count(*) from public.reporting_publish_jobs")).toBe(0);
  });
  it.each(["2026-11-02T12:00:00", "infinity", "not-a-date"])("rejects non-zoned/invalid schedules %s", async (notBefore) => {
    await approveDraft(); await expect(batch([{ ...entry(), notBefore }])).rejects.toThrow("explicit zoned");
  });
  it("refuses past/far-future schedules and time windows beyond the original work session", async () => {
    await approveDraft();
    for (const offset of [-60000, 9 * 3600000]) {
      await expect(batch([{ ...entry(), notBefore: new Date(Date.now() + offset).toISOString() }])).rejects.toThrow("permitted range");
    }
    await db.query("update public.reporting_work_sessions set started_at=clock_timestamp()-interval '9 hours 45 minutes' where id=$1", [session]);
    await expect(batch([{ ...entry(), notBefore: null }])).rejects.toThrow("current work session");
  });
  it("requires live verified staff and hides batch history from another tenant", async () => {
    await approveDraft(); await batch([entry()]);
    expect(await as("authenticated", other, () => scalar("select count(*) from public.reporting_publish_batches"))).toBe(0);
    await expect(agent(() => scalar("select public.reporting_enqueue_publish_batch($1,$2,'[]')", [org, request]))).rejects.toThrow("permission denied");
    await db.query("update auth.users set email_confirmed_at=null where id=$1", [user]);
    await expect(batch([entry()])).rejects.toThrow("Verified staff");
  });
  it("pauses scheduled work and never transfers it into a new operator session", async () => {
    await approveDraft(); await batch([{ ...entry(), notBefore: null }]);
    await owner(() => scalar("select public.reporting_session_action($1,'pause','America/Los_Angeles')", [org]));
    expect(await claim()).toBeNull();
    await owner(() => scalar("select public.reporting_session_action($1,'end','America/Los_Angeles')", [org]));
    await owner(() => scalar("select public.reporting_session_action($1,'start','America/Los_Angeles')", [org]));
    expect(await claim()).toBeNull(); expect(await scalar("select status from public.reporting_publish_jobs")).toBe("cancelled");
  });
  it.each([0, 31, 5.5, null, "10"])("rejects invalid dispatch window %#", async (windowMinutes) => {
    await approveDraft(); await expect(batch([{ ...entry(), windowMinutes }])).rejects.toThrow("Invalid scheduled");
  });
});

describe("opt-in automatic result-to-Sheet mapping", () => {
  const rowId = "99999999-9999-4999-8999-999999999999";
  async function publication() {
    await owner(() => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer, JSON.stringify([{ title: "Mapped exact post", url: "https://nextdoor.com/p/mapping-fixture", account_label: "Profile A" }])]));
    return String(await scalar("select id from public.reporting_publications where url='https://nextdoor.com/p/mapping-fixture'"));
  }
  const map = (id: string, enabled = true, revision = 1) => owner(() => scalar("select public.reporting_set_publication_sheet_mapping($1,$2,'Auto Posting',$3,$4,$5)", [org, id, rowId, revision, enabled]));
  const check = (id: string, outcome = "alive") => owner(() => scalar("select public.reporting_record_checks($1,$2::jsonb)", [org, JSON.stringify([{ publication_id: id, outcome }])]));
  it("has no implicit mappings and never queues result writes by default", async () => {
    const id = await publication(); await check(id); expect(await scalar("select count(*) from public.reporting_sheet_writeback_outbox")).toBe(0);
  });
  it("maps sourced checks to one exact stable row/revision and preserves technical failures", async () => {
    const id = await publication(); await map(id); await check(id, "network_error");
    const value = await scalar("select intent from public.reporting_sheet_writeback_outbox") as Record<string, unknown>;
    expect(value).toEqual({ action: "update_cells", tab: "Auto Posting", rowRef: `id:${rowId}`, values: [{ Status: "network_error", "Post link": "https://nextdoor.com/p/mapping-fixture", __expected_revision: "1" }] });
    expect(await scalar("select visibility from public.reporting_publications where id=$1", [id])).toBe("not_checked");
    expect(await scalar("select next_revision from public.reporting_sheet_publication_mappings")).toBe(2);
  });
  it("reserves successive revisions atomically and records exact event/outbox links", async () => {
    const id = await publication(); await map(id); await check(id); await check(id, "needs_review");
    expect(await scalar("select count(*) from public.reporting_sheet_delivery_events where disposition='queued'")).toBe(2);
    const rows = (await db.query<{ revision: string }>("select intent->'values'->0->>'__expected_revision' revision from public.reporting_sheet_writeback_outbox order by seq")).rows;
    expect(rows.map((row) => row.revision)).toEqual(["1", "2"]);
  });
  it("can pause without deleting pending writes, but refuses rebasing while writes are outstanding", async () => {
    const id = await publication(); await map(id); await check(id);
    await expect(map(id, true, 20)).rejects.toThrow("Reconcile outstanding");
    await map(id, false, 20); await check(id);
    expect(await scalar("select count(*) from public.reporting_sheet_writeback_outbox")).toBe(1);
    expect(await scalar("select next_revision from public.reporting_sheet_publication_mappings")).toBe(2);
  });
  it("skips writes after the author loses verified staff access while retaining the sourced result", async () => {
    const id = await publication(); await map(id);
    await db.query("update auth.users set email_confirmed_at=null where id=$1", [user]);
    await db.query("insert into public.reporting_post_checks(organization_id,publication_id,outcome,tone,message,source) values($1,$2,'alive','positive','Fixture check','auto_check')", [org, id]);
    expect(await scalar("select count(*) from public.reporting_sheet_writeback_outbox")).toBe(0);
    expect(await scalar("select disposition from public.reporting_sheet_delivery_events")).toBe("skipped_authorization");
    expect(await scalar("select count(*) from public.reporting_post_checks")).toBe(1);
  });
  it("automatically appends a newly submitted exact publication and then maps its checks", async () => {
    await owner(() => scalar("select public.reporting_set_publish_sheet_target($1,$2,true,true)", [org, binding]));
    await approveDraft(); await enqueue(); const job = (await claim())!; await complete(job);
    const pid = String(await scalar("select id from public.reporting_publications"));
    const value = await scalar("select intent from public.reporting_sheet_writeback_outbox") as Record<string, unknown>;
    expect(value).toEqual({ action: "append", tab: "Auto Posting", rowRef: null, values: [{ "ND Row ID": pid, "Profile Name": "Profile A", "Post link": "https://nextdoor.com/p/exact-fixture-link", Status: "not_checked" }] });
    expect(await complete(job)).toBe(false); expect(await scalar("select count(*) from public.reporting_sheet_writeback_outbox")).toBe(1);
    await check(pid);
    expect(await scalar("select count(*) from public.reporting_sheet_writeback_outbox")).toBe(2);
  });
  it("an ambiguous/failed submission never manufactures a Sheet publication", async () => {
    await owner(() => scalar("select public.reporting_set_publish_sheet_target($1,$2,true,true)", [org, binding]));
    await approveDraft(); await enqueue(); const job = (await claim())!;
    await complete(job, { ...ok(), outcome: "needs_reconciliation", post_url: null, published_at: null });
    expect(await scalar("select count(*) from public.reporting_sheet_writeback_outbox")).toBe(0);
  });
  it("does not grant another tenant, unverified user or anonymous caller mapping access", async () => {
    const id = await publication(); await map(id);
    expect(await as("authenticated", other, () => scalar("select count(*) from public.reporting_sheet_publication_mappings"))).toBe(0);
    await expect(as("authenticated", other, () => scalar("select public.reporting_set_publication_sheet_mapping($1,$2,'Auto Posting',$3,1,true)", [org, id, rowId]))).rejects.toThrow("Verified staff");
    await expect(agent(() => scalar("select public.reporting_set_publish_sheet_target($1,$2,true,true)", [org, binding]))).rejects.toThrow("permission denied");
    await expect(owner(() => scalar("update public.reporting_sheet_publication_mappings set next_revision=100"))).rejects.toThrow("permission denied");
  });
  it("serialized claims cannot skip an in-flight dependency and return exact stored lease data", async () => {
    const id = await publication(); await map(id); await check(id); await check(id);
    const firstRequest = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secondRequest = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = await owner(() => scalar("select public.reporting_claim_sheet_writeback_v1($1,1,$2)", [org, firstRequest])) as Array<{ id: string; leaseToken: string; expiresAt: string; attempts: number }>;
    expect(first).toHaveLength(1); expect(first[0].attempts).toBe(1);
    expect(Date.parse(first[0].expiresAt)).toBe(Date.parse(String(await scalar("select lease_expires_at::text from public.reporting_sheet_writeback_outbox where id=$1", [first[0].id]))));
    expect(await owner(() => scalar("select public.reporting_claim_sheet_writeback_v1($1,1,$2)", [org, secondRequest]))).toEqual([]);
    expect(await owner(() => scalar("select public.reporting_claim_sheet_writeback_v1($1,1,$2)", [org, firstRequest]))).toEqual(first);
    await owner(() => scalar("select public.reporting_ack_sheet_writeback_v1($1,$2,$3,'delivered','{}',null,$4)", [org, first[0].id, first[0].leaseToken, "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]));
    const next = await owner(() => scalar("select public.reporting_claim_sheet_writeback_v1($1,1,$2)", [org, "aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaaa"])) as Array<{ id: string }>;
    expect(next).toHaveLength(1); expect(next[0].id).not.toBe(first[0].id);
  });
});

describe("immutable approved media and old-worker compatibility", () => {
  const image = { id: "99999999-9999-4999-8999-999999999999", sha256: "b".repeat(64), bytes: 1024, mime: "image/png", name: "fixture.png", rightsConfirmed: true, privacyReviewed: true };
  async function mediaDraft(media: unknown) {
    await owner(() => scalar("select public.reporting_save_content_draft($1,$2,0,$3,$4::jsonb)", [org, draftId, binding, JSON.stringify({ ...content, media })]));
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,1,'approve',true)", [org, draftId]));
    await enqueue();
  }
  it("old claimants skip media jobs and a new capable claimant receives exact approved descriptors", async () => {
    await mediaDraft([image]); expect(await claim()).toBeNull();
    expect(await scalar("select status from public.reporting_publish_jobs")).toBe("pending");
    const result = await agent(() => scalar("select public.reporting_claim_publish_v2($1)", [token]));
    expect(result).toMatchObject({ body: content.body, media: [image], draft_revision: 2 });
  });
  it("empty optional media does not break a legacy text-only worker's exact contract", async () => {
    await mediaDraft([]); const result = await claim(); expect(result).not.toHaveProperty("media");
  });
  it.each([null, [image, image], [{ ...image, rightsConfirmed: false }], [{ ...image, privacyReviewed: false }], [{ ...image, path: "C:/private.png" }],
    [{ ...image, name: "../private.png" }], [{ ...image, mime: "image/svg+xml" }], [{ ...image, bytes: true }], [{ ...image, bytes: 8388609 }]])("refuses unsupported or unapproved image metadata %#", async (media) => {
    await expect(mediaDraft(media)).rejects.toThrow("Invalid draft"); expect(await scalar("select count(*) from public.reporting_publish_jobs")).toBe(0);
  });
  it("requires fresh approval for changed image fingerprints just as for changed text", async () => {
    await mediaDraft([image]);
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,2,'return',true)", [org, draftId]));
    await owner(() => scalar("select public.reporting_save_content_draft($1,$2,3,$3,$4::jsonb)", [org, draftId, binding, JSON.stringify({ ...content, media: [{ ...image, sha256: "c".repeat(64) }] })]));
    expect(await agent(() => scalar("select public.reporting_claim_publish_v2($1)", [token]))).toBeNull();
    expect(await scalar("select status from public.reporting_publish_jobs")).toBe("cancelled");
  });
});

describe("claim and complete protocol", () => {
  it("blocks publishing while a browser-task lease is held and permits it only after completion", async () => {
    const task = await owner(() => scalar("select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','Read counts','{}')", [org, worker]));
    const leased = await agent(() => scalar("select public.reporting_claim_automation_task($1)", [token])) as { lease_token: string };
    await approveDraft(); await enqueue();
    expect(await claim()).toBeNull();
    await agent(() => scalar("select public.reporting_complete_automation_task($1,$2,$3,'succeeded',$4,null)", [token, task, leased.lease_token, JSON.stringify({ profiles: 0, groups: 0 })]));
    expect(await claim()).not.toBeNull();
  });
  it("keeps the legacy claimant private and exposes only a harmless authenticated version check", async () => {
    expect(await owner(() => scalar("select public.reporting_publisher_protocol_version()"))).toBe(1);
    await expect(agent(() => scalar("select public.reporting_publisher_protocol_version()"))).rejects.toThrow();
    await expect(agent(() => scalar("select private_reporting.reporting_claim_publish($1)", [token]))).rejects.toThrow();
    await expect(owner(() => scalar("select private_reporting.reporting_claim_publish($1)", [token]))).rejects.toThrow();
  });
  it("revokes pending publishing when the session owner is unverified or the session is future-dated", async () => {
    for (const invalidate of [
      () => db.query("update auth.users set email_confirmed_at=null where id=$1", [user]),
      () => db.query("update public.reporting_work_sessions set started_at=clock_timestamp()+interval '1 hour' where id=$1", [session]),
    ]) {
      await db.exec("savepoint invalid_publisher");
      await approveDraft(); await enqueue(); await invalidate();
      expect(await claim()).toBeNull();
      expect(await scalar("select status from public.reporting_publish_jobs")).toBe("cancelled");
      await db.exec("rollback to savepoint invalid_publisher; release savepoint invalid_publisher");
    }
  });
  it("withdrawn approval cancels pending work rather than publishing edited content", async () => {
    await approveDraft(); await enqueue();
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,2,'return',true)", [org, draftId]));
    await owner(() => scalar("select public.reporting_save_content_draft($1,$2,3,$3,$4::jsonb)", [org, draftId, binding, JSON.stringify({ ...content, body: "Changed later" })]));
    expect(await claim()).toBeNull();
    expect(await scalar("select content_snapshot->>'body' from public.reporting_publish_jobs")).toBe(content.body);
    expect(await scalar("select status from public.reporting_publish_jobs")).toBe("cancelled");
  });
  it("paused and expired sessions cannot claim new publishing work", async () => {
    await approveDraft(); await enqueue();
    await owner(() => scalar("select public.reporting_session_action($1,'pause','America/Los_Angeles')", [org]));
    expect(await claim()).toBeNull();
    await db.query("update public.reporting_work_sessions set started_at=clock_timestamp()-interval '11 hours' where id=$1", [session]);
    expect(await claim()).toBeNull();
    expect(await scalar("select status from public.reporting_publish_jobs")).toBe("cancelled");
  });
  it("an author losing staff access prevents future publish claims", async () => {
    await approveDraft(); await enqueue();
    await db.query("update public.reporting_memberships set role='customer' where organization_id=$1 and user_id=$2", [org, user]);
    expect(await claim()).toBeNull();
  });
  it("changed assignments cancel pending jobs instead of changing their targets", async () => {
    await approveDraft(); await enqueue();
    await db.query("update public.reporting_worker_profiles set account_label='Changed label' where id=$1", [binding]);
    expect(await claim()).toBeNull();
    expect(await scalar("select target_snapshot->>'account_label' from public.reporting_publish_jobs")).toBe("Profile A");
  });
  it("normalizes www URLs and captures duplicates without a second publication", async () => {
    await owner(() => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer, JSON.stringify([{ title: "Existing", url: "https://nextdoor.com/p/exact-fixture-link", account_label: "Profile A" }])]));
    await approveDraft(); await enqueue(); const job = (await claim())!;
    await complete(job, { ...ok(), post_url: "https://www.nextdoor.com/p/exact-fixture-link" });
    expect(await scalar("select count(*) from public.reporting_publications")).toBe(1);
    expect(await scalar("select outcome from public.reporting_publish_jobs")).toBe("needs_reconciliation");
  });
  it.each(["2026-10-27T12:00:00", "not-a-date", "infinity"])('rejects non-zoned publication timestamp %s', async (published_at) => {
    await approveDraft(); await enqueue(); const job = (await claim())!;
    await expect(complete(job, { ...ok(), published_at })).rejects.toThrow("explicit timezone");
  });
  it("rejects listing URLs returned for a text post", async () => {
    await approveDraft(); await enqueue(); const job = (await claim())!;
    await expect(complete(job, { ...ok(), post_url: "https://nextdoor.com/for_sale_and_free/wrong-kind" })).rejects.toThrow("URL type");
  });
  it("completion records the leased snapshot even if the draft was edited in flight", async () => {
    await approveDraft(); await enqueue(); const job = (await claim())!;
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,2,'return',true)", [org, draftId]));
    await owner(() => scalar("select public.reporting_save_content_draft($1,$2,3,$3,$4::jsonb)", [org, draftId, binding, JSON.stringify({ ...content, title: "Changed after claim" })]));
    await complete(job);
    expect(await scalar("select title from public.reporting_publications")).toBe(content.title);
    expect(await scalar("select adapter_sha256 from public.reporting_publish_jobs")).toBe("f".repeat(64));
  });
  it("blocks publish claims while a monitoring lease is held", async () => {
    await owner(() => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer, JSON.stringify([{ title: "Due post", url: "https://nextdoor.com/p/monitor-first", account_label: "Profile A" }])]));
    await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]));
    expect(await agent(() => scalar("select public.reporting_claim_check($1)", [token]))).not.toBeNull();
    await approveDraft(); await enqueue(); expect(await claim()).toBeNull();
  });
  it("rejects invalid tokens and hides jobs from another tenant", async () => {
    await approveDraft(); await enqueue();
    expect(await as("authenticated", other, () => scalar("select count(*) from public.reporting_publish_jobs"))).toBe(0);
    await expect(agent(() => scalar("select public.reporting_claim_publish('invalid')"))).rejects.toThrow("Invalid worker credential");
    await expect(owner(() => scalar("update public.reporting_publish_jobs set status='completed' returning id"))).rejects.toThrow("permission denied");
  });
  it("revocation cancels pending jobs and denies new claims", async () => {
    await approveDraft(); await enqueue();
    await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
    expect(await scalar("select status from public.reporting_publish_jobs")).toBe("cancelled");
    await expect(claim()).rejects.toThrow("Invalid worker credential");
  });
  it("reassignment refuses an unresolved publish lease", async () => {
    await approveDraft(); await enqueue(); await claim();
    const replacement = await owner(() => scalar("select public.reporting_register_worker($1,'Replacement PC',$2)", [org, hash("cd".repeat(32))]));
    await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
    await expect(owner(() => scalar("select public.reporting_reassign_worker_profile($1,$2,$3)", [org, binding, replacement]))).rejects.toThrow("Reconcile outstanding leases");
  });
  it.each([{ post_url: 7 }, { published_at: 123 }, { post_url: {} }, { outcome: null }, { adapter_sha256: null }])("rejects wrong result types %#", async (fields) => {
    await approveDraft(); await enqueue(); const job = (await claim())!;
    await expect(complete(job, { ...ok(), ...fields })).rejects.toThrow("Invalid result fields");
  });
  it("bounds diagnostic notes even when a duplicate link is reconciled", async () => {
    await owner(() => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer, JSON.stringify([{ title: "Existing", url: "https://nextdoor.com/p/exact-fixture-link", account_label: "Profile A" }])]));
    await approveDraft(); await enqueue(); const job = (await claim())!;
    expect(await complete(job, { ...ok(), reason: "x".repeat(2000) })).toBe(true);
    expect(Number(await scalar("select length(failure_notes) from public.reporting_publish_jobs"))).toBeLessThanOrEqual(2000);
  });
  it("returns the immutable approved content and exact target", async () => {
    await approveDraft(); await enqueue();
    const job = await claim();
    expect(job).toMatchObject({ kind: "post", title: content.title, body: content.body, audience: "neighborhood", profile_id: profile, customer_id: customer, account_label: "Profile A", draft_revision: 2 });
    expect(await scalar("select last_seen_at is not null from public.reporting_workers where id=$1", [worker])).toBe(true);
  });
  it("serializes leases across monitor and publish jobs and rejects wrong lease replay", async () => {
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    expect(await claim()).toBeNull();
    await expect(complete(job, ok(), "00000000-0000-0000-0000-000000000000")).rejects.toThrow("Invalid lease");
    expect(await claim()).toBeNull();
  });
  it("blocks check claims while a publish lease is active, then resumes normally", async () => {
    // Give the worker a plannable check (monitoring-enabled binding + due publication).
    await owner(() => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer, JSON.stringify([{ title: "Due post", url: "https://nextdoor.com/p/due-check-fixture", account_label: "Profile A" }])]));
    await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]));
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    // While the publish lease is held, neither job type may be leased again.
    expect(await agent(() => scalar("select public.reporting_claim_check($1)", [token]))).toBeNull();
    expect(await claim()).toBeNull();
    expect(await complete(job)).toBe(true);
    // After completion the normal monitoring claim path resumes and plans the due check.
    const check = await agent(() => scalar("select public.reporting_claim_check($1)", [token])) as { publication_id?: string } | null;
    expect(check?.publication_id).toBeTruthy();
  }, 15000);
  it("submits exactly once, creating one not-checked publication with provenance", async () => {
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    expect(await complete(job)).toBe(true);
    expect(await complete(job)).toBe(false);
    const pub = await scalar("select jsonb_build_object('source',source,'visibility',visibility,'label',account_label,'session',recorded_session_id::text,'title',title) from public.reporting_publications where organization_id=$1", [org]);
    expect(pub).toEqual({ source: "worker_publish", visibility: "not_checked", label: "Profile A", session, title: content.title });
    expect(await scalar("select count(*) from public.reporting_publish_jobs where outcome='submitted'")).toBe(1);
  });
  it("never duplicates an existing publication URL; downgrades to reconciliation", async () => {
    await owner(() => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer, JSON.stringify([{ title: "Existing", url: "https://nextdoor.com/p/exact-fixture-link", account_label: "Profile A" }])]));
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    expect(await complete(job)).toBe(true);
    expect(await scalar("select outcome from public.reporting_publish_jobs where id=$1", [job.job_id])).toBe("needs_reconciliation");
    expect(await scalar("select count(*) from public.reporting_publications where organization_id=$1", [org])).toBe(1);
    expect(await scalar("select count(*) from public.reporting_notifications where kind='publish_result'")).toBe(1);
  });
  it("rejects results missing the exact link or with mismatched fields", async () => {
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    await expect(complete(job, { ...ok(), post_url: null })).rejects.toThrow("exact canonical post URL");
    await expect(complete(job, { ...ok(), post_url: "https://example.com/x" })).rejects.toThrow("exact canonical post URL");
    await expect(complete(job, { ...ok(), outcome: "network_error" })).rejects.toThrow("only valid for a submitted outcome");
    await expect(complete(job, { ...ok(), extra: true })).rejects.toThrow("Invalid result");
    await expect(complete(job, { ...ok(), reason: " " })).rejects.toThrow("Invalid result fields");
    expect(await scalar("select status from public.reporting_publish_jobs where id=$1", [job.job_id])).toBe("leased");
  });
  it("records typed failures without publications and notifies staff", async () => {
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    const failure = { outcome: "verification_required", reason: "Identity challenge shown; handed to operator", adapter_sha256: "f".repeat(64), post_url: null, published_at: null };
    expect(await complete(job, failure)).toBe(true);
    expect(await scalar("select count(*) from public.reporting_publications where organization_id=$1", [org])).toBe(0);
    expect(await scalar("select tone from public.reporting_notifications where kind='publish_result'")).toBe("attention");
  });
  it("treats an expired submission as ambiguous and blocks reposts even after reapproval", async () => {
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    await owner(() => scalar("select public.reporting_reconcile_expired_publish($1,$2)", [org, job.job_id])).catch((e) => expect(String(e)).toContain("expired"));
    await db.query("update public.reporting_publish_jobs set lease_expires_at = clock_timestamp() - interval '1 minute' where id=$1", [job.job_id]);
    await owner(() => scalar("select public.reporting_reconcile_expired_publish($1,$2)", [org, job.job_id]));
    await expect(enqueue()).rejects.toThrow("do not repost");
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,2,'return',true)", [org, draftId]));
    await owner(() => scalar("select public.reporting_review_content_draft($1,$2,3,'approve',true)", [org, draftId]));
    await expect(owner(() => scalar("select public.reporting_enqueue_publish($1,$2,4)", [org, draftId]))).rejects.toThrow("do not repost");
    expect(await scalar("select outcome from public.reporting_publish_jobs where id=$1", [job.job_id])).toBe("needs_reconciliation");
  });
  it("rejects expired leases on completion", async () => {
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    await db.query("update public.reporting_publish_jobs set lease_expires_at = clock_timestamp() - interval '1 minute' where id=$1", [job.job_id]);
    await expect(complete(job)).rejects.toThrow("Expired or inactive lease");
  });
  it("cancels only pending jobs", async () => {
    await approveDraft(); await enqueue();
    const job = (await claim())!;
    await expect(owner(() => scalar("select public.reporting_cancel_pending_publish($1,$2)", [org, job.job_id]))).rejects.toThrow("Only a pending job");
    expect(await scalar("select status from public.reporting_publish_jobs where id=$1", [job.job_id])).toBe("leased");
  });
});
