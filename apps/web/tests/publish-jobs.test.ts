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

describe("claim and complete protocol", () => {
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
