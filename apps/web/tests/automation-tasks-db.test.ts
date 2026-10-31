import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

// Exercises the browser task queue exactly as the hosted database would: staff
// enqueue, the paired laptop claims with its scoped credential, and results are
// written only through the RPC. Nothing here touches a browser.
const db = new PGlite();
const owner = randomUUID(), operator = randomUUID(), client = randomUUID();
const token = "c".repeat(64);
let org: string, worker: string;

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
  await db.exec("begin");
  org = String(await rpc(owner, "select public.reporting_create_workspace('Automation fixture')"));
  await db.query("insert into public.reporting_memberships values ($1,$2,'operator'),($1,$3,'customer')", [org, operator, client]);
  worker = String(await rpc(owner, "select public.reporting_register_worker($1,'Automation laptop',$2)", [org, createHash("sha256").update(token).digest("hex")]));
  await db.exec("commit");
}, 120000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

it("refuses task types the dashboard must never execute", async () => {
  for (const kind of ["publish_post", "publish_listing", "account_create", "shell", ""]) {
    await expect(rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,$3,$4,$5)",
      [org, worker, kind, "Attempt", JSON.stringify({})])).rejects.toThrow();
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
  // A replayed completion is acknowledged without double-writing.
  expect(await complete(task, claimed.lease_token, "succeeded", { profile_id: profileId })).toBe(false);
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
