import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

// Exercises the browser task queue exactly as the hosted database would: staff
// enqueue, this device's automation agent claims with its scoped credential,
// and results are written only through the RPC. Nothing here touches a browser.
const db = new PGlite();
const owner = randomUUID(), operator = randomUUID(), client = randomUUID();
const token = "c".repeat(64);
let org: string, worker: string, session: string, legacyTask: string;

async function scalar(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<Record<string, unknown>>(sql, params);
  return Object.values(rows[0])[0];
}
async function as<T>(actor: string, operation: () => Promise<T>, role = "authenticated") {
  await db.exec("savepoint automation_actor");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${actor}';`);
  try {
    const value = await operation();
    await db.exec("reset role; reset request.jwt.claim.sub; release savepoint automation_actor");
    return value;
  } catch (error) {
    await db.exec("rollback to savepoint automation_actor; release savepoint automation_actor");
    throw error;
  }
}
const rpc = (actor: string, sql: string, params: unknown[] = []) => as(actor, () => scalar(sql, params));
const claimTask = () => as("", () => scalar("select public.reporting_claim_automation_task($1)", [token]), "anon");
const complete = (task: string, lease: string, status: string, result: unknown, error: string | null = null) =>
  as("", () => scalar("select public.reporting_complete_automation_task($1,$2,$3,$4,$5,$6)",
    [token, task, lease, status, result === null ? null : JSON.stringify(result), error]), "anon");

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;`);
  for (const actor of [owner, operator, client]) await db.query("insert into auth.users values ($1,now())", [actor]);
  for (const name of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql", "202610270004_content_drafts.sql", "202610270005_profile_inventory.sql", "202610270006_publish_jobs.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(await readFile(new URL("../../../supabase/migrations/20261031093000_automation_tasks_v1.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/migrations/20261031120000_cookie_proxy_write_v1.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/migrations/20261031150000_inventory_scan_v1.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  org = String(await rpc(owner, "select public.reporting_create_workspace('Automation fixture')"));
  await db.query("insert into public.reporting_memberships values ($1,$2,'operator'),($1,$3,'customer')", [org, operator, client]);
  worker = String(await rpc(owner, "select public.reporting_register_worker($1,'Automation laptop',$2)", [org, createHash("sha256").update(token).digest("hex")]));
  legacyTask = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Legacy pending scan','{}')", [org, worker]));
  await db.exec("commit");
  await db.exec(await readFile(new URL("../../../supabase/migrations/202611020001_automation_session_gate.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/migrations/202611020006_browser_task_receipts.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/migrations/202611030001_inventory_scan_cap_v2.sql", import.meta.url), "utf8"));
}, 120000);
beforeEach(async () => {
  await db.exec("begin");
  session = String(await rpc(operator, "select public.reporting_session_action($1,'start','UTC')", [org]));
});
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

it("refuses task types the dashboard must never execute", async () => {
  for (const kind of ["publish_post", "publish_listing", "account_create", "shell", ""]) {
    await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,$3,$4,$5)",
      [org, worker, kind, "Attempt", JSON.stringify({})])).rejects.toThrow();
  }
});

it("cancels legacy pending tasks instead of inheriting authorization", async () => {
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [legacyTask])).toBe("cancelled");
  expect(await claimTask()).toBeNull();
});

it("requires a current, verified operator work session and keeps the bypass helper private", async () => {
  await rpc(operator, "select public.reporting_session_action($1,'end','UTC')", [org]);
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Scan','{}')", [org, worker])).rejects.toThrow("Start an active work session");
  for (const role of ["anon", "authenticated"]) {
    await expect(as(operator, () => scalar("select private_reporting.reporting_enqueue_automation_task($1,$2,'inventory_scan','Scan','{}')", [org, worker]), role)).rejects.toThrow();
  }
});

it("does not substitute another staff member's active session", async () => {
  await expect(rpc(owner, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Scan','{}')", [org, worker])).rejects.toThrow("Start an active work session");
});

it("pause blocks dispatch, resume permits it, and completion may finish after pause", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Scan','{}')", [org, worker]));
  expect(await scalar("select session_id from public.reporting_automation_tasks where id=$1", [task])).toBe(session);
  await rpc(operator, "select public.reporting_session_action($1,'pause','UTC')", [org]);
  expect(await claimTask()).toBeNull();
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [task])).toBe("pending");
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Scan','{}')", [org, worker])).rejects.toThrow("Start an active work session");
  await rpc(operator, "select public.reporting_session_action($1,'resume','UTC')", [org]);
  const claimed = await claimTask() as { task_id: string; lease_token: string };
  expect(claimed.task_id).toBe(task);
  await rpc(operator, "select public.reporting_session_action($1,'pause','UTC')", [org]);
  expect(await complete(task, claimed.lease_token, "succeeded", { profiles: [], total: 0, truncated: false })).toBe(true);
});

it("ending a session cancels its pending task even after a new session starts", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Scan','{}')", [org, worker]));
  await rpc(operator, "select public.reporting_session_action($1,'end','UTC')", [org]);
  await rpc(operator, "select public.reporting_session_action($1,'start','UTC')", [org]);
  expect(await claimTask()).toBeNull();
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [task])).toBe("cancelled");
});

it("expired, future-dated, unverified or revoked session authorizations never dispatch", async () => {
  for (const invalidate of [
    () => db.query("update public.reporting_work_sessions set started_at=clock_timestamp()-interval '11 hours' where id=$1", [session]),
    () => db.query("update public.reporting_work_sessions set started_at=clock_timestamp()+interval '1 hour' where id=$1", [session]),
    () => db.query("update auth.users set email_confirmed_at=null where id=$1", [operator]),
    () => db.query("update public.reporting_memberships set role='customer' where organization_id=$1 and user_id=$2", [org, operator]),
  ]) {
    await db.exec("savepoint invalid_authorization");
    const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Scan','{}')", [org, worker]));
    await invalidate();
    expect(await claimTask()).toBeNull();
    expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [task])).toBe("cancelled");
    await db.exec("rollback to savepoint invalid_authorization; release savepoint invalid_authorization");
  }
});

it("refuses a non-staff member and an unknown worker", async () => {
  await expect(rpc(client, "select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','Snapshot',$3)",
    [org, worker, JSON.stringify({})])).rejects.toThrow();
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','Snapshot',$3)",
    [org, randomUUID(), JSON.stringify({})])).rejects.toThrow();
});

it("validates the payload instead of trusting the browser", async () => {
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'profile_create','Profile',$3)",
    [org, worker, JSON.stringify({})])).rejects.toThrow();
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'profile_create','Profile',$3)",
    [org, worker, JSON.stringify({ name: "ok", os: "solaris" })])).rejects.toThrow();
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'profile_create','Profile',$3)",
    [org, worker, JSON.stringify({ name: "ok", password: "secret" })])).rejects.toThrow();
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'cookie_import','Cookies',$3)",
    [org, worker, JSON.stringify({ path: "" })])).rejects.toThrow();
});

it("runs a profile creation task through claim and completion", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'profile_create','Create $1 profile',$3)",
    [org, worker, JSON.stringify({ name: "Fixture profile", os: "windows", group: "Fixture group" })]));
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [task])).toBe("pending");

  const claimed = await claimTask() as { task_id: string; kind: string; payload: { name: string }; lease_token: string };
  expect(claimed.task_id).toBe(task);
  expect(claimed.kind).toBe("profile_create");
  expect(claimed.payload.name).toBe("Fixture profile");

  // A second claim must not overlap while the lease is live.
  expect(await claimTask()).toBeNull();
  // Monitoring must not start a browser while an automation lease is open.
  expect(await as("", () => scalar("select public.reporting_claim_check($1)", [token]), "anon")).toBeNull();

  const profileId = randomUUID();
  await expect(complete(task, randomUUID(), "succeeded", { profile_id: profileId })).rejects.toThrow("Invalid lease");
  expect(await complete(task, claimed.lease_token, "succeeded", { profile_id: profileId, name: "Fixture profile" })).toBe(true);
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [task])).toBe("succeeded");
  expect(await scalar("select result->>'profile_id' from public.reporting_automation_tasks where id=$1", [task])).toBe(profileId);
  // A replayed completion is acknowledged without double-writing; a changed
  // result is a conflict, never a silent overwrite (browser_task_receipts_v1).
  expect(await complete(task, claimed.lease_token, "succeeded", { profile_id: profileId, name: "Fixture profile" })).toBe(false);
  await expect(complete(task, claimed.lease_token, "succeeded", { profile_id: profileId })).rejects.toThrow("replay conflict");
});

it("rejects an incomplete success and accepts a bounded failure", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','Read presets',$3)",
    [org, worker, JSON.stringify({})]));
  const claimed = await claimTask() as { lease_token: string };
  await expect(complete(task, claimed.lease_token, "succeeded", {})).rejects.toThrow();
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: 3, groups: 1, secret: "x" })).rejects.toThrow();
  await expect(complete(task, claimed.lease_token, "failed", { profiles: 3 }, null)).rejects.toThrow();
  expect(await complete(task, claimed.lease_token, "failed", null, "Incogniton is not running on port 35000")).toBe(true);
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [task])).toBe("failed");
  expect(await scalar("select error from public.reporting_automation_tasks where id=$1", [task])).toBe("Incogniton is not running on port 35000");
});

it("keeps local file paths out of the result and reports only redacted counts", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'cookie_import','Check cookie file',$3)",
    [org, worker, JSON.stringify({ path: "C:\\Exports\\cookies.txt" })]));
  const claimed = await claimTask() as { lease_token: string };
  expect(await complete(task, claimed.lease_token, "succeeded", { entries: 12, with_credentials: 12, domains: 4, sample: [".nextdoor.com"] })).toBe(true);
  const result = await scalar("select result::text from public.reporting_automation_tasks where id=$1", [task]);
  expect(String(result)).not.toContain("C:\\\\Exports");
});

it("validates write payloads: one profile UUID, one absolute local file", async () => {
  const target = "44444444-4444-4444-8444-444444444444";
  const enqueue = (kind: string, payload: unknown) =>
    rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,$3,'Import into profile',$4)", [org, worker, kind, JSON.stringify(payload)]);
  await expect(enqueue("cookie_write", { profile_id: "not-a-uuid", path: "C:\\c.txt" })).rejects.toThrow();
  await expect(enqueue("cookie_write", { path: "C:\\c.txt" })).rejects.toThrow();
  await expect(enqueue("proxy_write", { profile_id: target, path: "ab" })).rejects.toThrow();
  await expect(enqueue("cookie_write", { profile_id: target, path: "C:\\c.txt", cookie_value: "SECRET" })).rejects.toThrow();
  await expect(enqueue("cookie_write", { profile_id: target, path: "C:\\c.txt", replace: "yes" })).rejects.toThrow();
  const task = String(await enqueue("cookie_write", { profile_id: target, path: "C:\\Exports\\cookies.txt", replace: true }));
  expect(await scalar("select payload->>'profile_id' from public.reporting_automation_tasks where id=$1", [task])).toBe(target);
  expect(await scalar("select (payload->>'replace')::boolean from public.reporting_automation_tasks where id=$1", [task])).toBe(true);
});

it("runs a cookie write then a proxy write through claim and completion, without secrets", async () => {
  const target = "44444444-4444-4444-8444-444444444444";
  const cookieTask = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'cookie_write','Import cookies into one profile',$3)",
    [org, worker, JSON.stringify({ profile_id: target, path: "C:\\Exports\\cookies.txt", replace: true })]));
  const claimed = await claimTask() as { task_id: string; kind: string; payload: { profile_id: string; replace: boolean }; lease_token: string };
  expect(claimed.task_id).toBe(cookieTask);
  expect(claimed.kind).toBe("cookie_write");
  expect(claimed.payload.profile_id).toBe(target);
  expect(claimed.payload.replace).toBe(true);
  // A written count of zero or a smuggled cookie value must be refused.
  await expect(complete(cookieTask, claimed.lease_token, "succeeded", { written: 0 })).rejects.toThrow();
  await expect(complete(cookieTask, claimed.lease_token, "succeeded", { written: 12, cookie_value: "SECRET" })).rejects.toThrow();
  expect(await complete(cookieTask, claimed.lease_token, "succeeded", { entries: 12, written: 12, replaced: true })).toBe(true);
  const store = await scalar("select result::text from public.reporting_automation_tasks where id=$1", [cookieTask]);
  expect(String(store)).not.toContain("SECRET");

  const proxyTask = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'proxy_write','Set proxy on one profile',$3)",
    [org, worker, JSON.stringify({ profile_id: target, path: "C:\\Exports\\proxies.txt" })]));
  const claimedProxy = await claimTask() as { kind: string; lease_token: string };
  expect(claimedProxy.kind).toBe("proxy_write");
  // Credentials must not ride along in the applied host:port.
  await expect(complete(proxyTask, claimedProxy.lease_token, "succeeded", { entries: 2, applied: "1.2.3.4:1080:user:pass" })).rejects.toThrow();
  await expect(complete(proxyTask, claimedProxy.lease_token, "succeeded", { applied: "jdbc://bad" })).rejects.toThrow();
  expect(await complete(proxyTask, claimedProxy.lease_token, "succeeded", { entries: 2, applied: "1.2.3.4:1080" })).toBe(true);
  expect(await scalar("select result->>'applied' from public.reporting_automation_tasks where id=$1", [proxyTask])).toBe("1.2.3.4:1080");
});

it("only one open task per laptop remains the rule while a scan is queued", async () => {
  const scan = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Detect profiles',$3)",
    [org, worker, JSON.stringify({})]));
  expect(await scalar("select kind from public.reporting_automation_tasks where id=$1", [scan])).toBe("inventory_scan");
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','Second',$3)",
    [org, worker, JSON.stringify({})])).rejects.toThrow();
});

it("validates a scan result shape and refuses smuggled row fields", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Detect profiles',$3)",
    [org, worker, JSON.stringify({})]));
  const claimed = await claimTask() as { kind: string; lease_token: string };
  expect(claimed.kind).toBe("inventory_scan");
  const row = { profile_id: randomUUID(), name: "ND 001", group_name: "Team A" };
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: [row], total: 1 })).rejects.toThrow();
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: [row], total: 1, truncated: "no" })).rejects.toThrow();
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: [{ ...row, cookies: "SECRET" }], total: 1, truncated: false })).rejects.toThrow();
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: [{ profile_id: "not-a-uuid", name: "x", group_name: "g" }], total: 1, truncated: false })).rejects.toThrow();
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: [{ profile_id: row.profile_id, name: "x", group_name: "g" }], total: 5001, truncated: false })).rejects.toThrow();
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: [{ profile_id: row.profile_id, name: "x", group_name: "g" }], total: 4, truncated: true, secret: "x" })).rejects.toThrow();
});

it("stores a full capped scan, then feeds it straight into the inventory import", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Detect profiles',$3)",
    [org, worker, JSON.stringify({})]));
  const claimed = await claimTask() as { lease_token: string };
  // 300 rows is far over the general 8000-byte result cap: only the scan allowance accepts it.
  const rows = Array.from({ length: 300 }, (_, i) => ({
    profile_id: randomUUID(), name: `Detected Profile ${String(i + 1).padStart(3, "0")}`, group_name: "Team A",
  }));
  expect(await complete(task, claimed.lease_token, "succeeded", { profiles: rows, total: 3220, truncated: true })).toBe(true);
  expect(await scalar("select jsonb_array_length(result->'profiles') from public.reporting_automation_tasks where id=$1", [task])).toBe(300);
  expect(await scalar("select count(*) from public.reporting_profile_inventory where organization_id=$1", [org])).toBe(0);
  // The stored rows flow into the same inventory import the CSV path uses, without archiving.
  await rpc(operator, "select public.reporting_import_profiles($1, (select result->'profiles' from public.reporting_automation_tasks where id=$2), false)", [org, task]);
  expect(await scalar("select count(*) from public.reporting_profile_inventory where organization_id=$1 and status='active'", [org])).toBe(300);
});

it("still refuses a scan result past its own 1,000,000-byte allowance", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Detect profiles',$3)",
    [org, worker, JSON.stringify({})]));
  const claimed = await claimTask() as { lease_token: string };
  const huge = Array.from({ length: 5000 }, () => ({
    profile_id: randomUUID(), name: "n".repeat(200), group_name: "Team A",
  }));
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: huge, total: 5000, truncated: true })).rejects.toThrow("Invalid task result");
});

it("stores a scan well past the old 500-row ceiling", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Detect 3,135 profiles',$3)",
    [org, worker, JSON.stringify({})]));
  const claimed = await claimTask() as { lease_token: string };
  const rows = Array.from({ length: 3135 }, (_, i) => ({
    profile_id: randomUUID(), name: `Detected Profile ${String(i + 1).padStart(4, "0")}`, group_name: "Team A",
  }));
  expect(await complete(task, claimed.lease_token, "succeeded", { profiles: rows, total: 3135, truncated: false })).toBe(true);
  expect(await scalar("select jsonb_array_length(result->'profiles') from public.reporting_automation_tasks where id=$1", [task])).toBe(3135);
  // The whole list must reach the same import path the CSV uses.
  await rpc(operator, "select public.reporting_import_profiles($1, (select result->'profiles' from public.reporting_automation_tasks where id=$2), false)", [org, task]);
  expect(await scalar("select count(*) from public.reporting_profile_inventory where organization_id=$1 and status='active'", [org])).toBe(3135);
});

it("accepts byte-budgeted scans with long multibyte names within the JSONB size cap", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Detect profiles','{}')", [org, worker]));
  const claimed = await claimTask() as { lease_token: string };
  const result = { profiles: [] as { profile_id: string; name: string; group_name: string }[], total: 5000, truncated: true };
  for (let i = 0; i < 5000; i++) {
    result.profiles.push({ profile_id: randomUUID(), name: "界".repeat(200), group_name: "界".repeat(200) });
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 900_000) { result.profiles.pop(); break; }
  }
  expect(result.profiles.length).toBeGreaterThan(0);
  expect(await complete(task, claimed.lease_token, "succeeded", result)).toBe(true);
  expect(Number(await scalar("select pg_column_size(result) from public.reporting_automation_tasks where id=$1", [task]))).toBeLessThan(1_000_000);
});

it("allows only one open task per laptop and lets staff cancel a pending one", async () => {
  const first = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','First',$3)",
    [org, worker, JSON.stringify({})]));
  await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','Second',$3)",
    [org, worker, JSON.stringify({})])).rejects.toThrow();
  await expect(rpc(client, "select public.reporting_cancel_automation_task($1,$2)", [org, first])).rejects.toThrow();
  await rpc(operator, "select public.reporting_cancel_automation_task($1,$2)", [org, first]);
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [first])).toBe("cancelled");
  await expect(rpc(operator, "select public.reporting_cancel_automation_task($1,$2)", [org, first])).rejects.toThrow();
});

it("reconciles an expired lease without re-running it", async () => {
  const task = String(await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','Expiring',$3)",
    [org, worker, JSON.stringify({})]));
  const claimed = await claimTask() as { lease_token: string };
  await expect(rpc(operator, "select public.reporting_reconcile_expired_automation_task($1,$2)", [org, task])).rejects.toThrow();
  await db.query("update public.reporting_automation_tasks set lease_expires_at = clock_timestamp() - interval '1 minute' where id=$1", [task]);
  await rpc(operator, "select public.reporting_reconcile_expired_automation_task($1,$2)", [org, task]);
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [task])).toBe("cancelled");
  await expect(complete(task, claimed.lease_token, "succeeded", { profiles: 0, groups: 0 })).rejects.toThrow();
});
