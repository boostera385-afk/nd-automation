import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const db = new PGlite();
const owner = randomUUID(), admin = randomUUID(), operator = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
const token = "a".repeat(64);
let org: string, worker: string, customer: string;
const profile = { profile_id: randomUUID(), name: "Fixture profile", group_name: "Fixture group" };
async function scalar(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<Record<string, unknown>>(sql, params);
  return Object.values(rows[0])[0];
}
async function as<T>(actor: string, operation: () => Promise<T>, role = "authenticated") {
  await db.exec("savepoint setup_actor");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${actor}';`);
  try {
    const result = await operation();
    await db.exec("reset role; reset request.jwt.claim.sub; release savepoint setup_actor");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint setup_actor; release savepoint setup_actor");
    throw error;
  }
}
const rpc = (actor: string, sql: string, params: unknown[] = []) => as(actor, () => scalar(sql, params));
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;`);
  for (const actor of [owner, admin, operator, viewer, outsider]) await db.query("insert into auth.users values ($1,now())", [actor]);
  for (const name of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql", "202610270004_content_drafts.sql", "202610270005_profile_inventory.sql", "202610270006_publish_jobs.sql", "20261031093000_automation_tasks_v1.sql", "20261031120000_cookie_proxy_write_v1.sql", "20261031150000_inventory_scan_v1.sql", "202611020001_automation_session_gate.sql", "202611020006_browser_task_receipts.sql", "202611030001_inventory_scan_cap_v2.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(await readFile(new URL("../../../supabase/proposals/admin_managed_setup.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  org = String(await rpc(owner, "select public.reporting_create_workspace('Fixture workspace')"));
  await db.query("insert into public.reporting_memberships values ($1,$2,'admin'),($1,$3,'operator'),($1,$4,'customer')", [org, admin, operator, viewer]);
  customer = String(await rpc(owner, "insert into public.reporting_customers(organization_id,name) values ($1,'Fixture customer') returning id", [org]));
  worker = String(await rpc(owner, "select public.reporting_register_worker($1,'Prepared laptop',$2)", [org, createHash("sha256").update(token).digest("hex")]));
  await db.exec("commit");
}, 120000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

it("denies operators/viewers/outsiders all six setup RPCs, including direct requests", async () => {
  for (const actor of [operator, viewer, outsider]) {
    for (const [sql, params] of [
      ["select public.reporting_register_worker($1,'Another laptop',$2)", [org, "b".repeat(64)]],
      ["select public.reporting_bind_worker_profile($1,$2,$3,$4,'Fixture profile')", [org, worker, customer, profile.profile_id]],
      ["select public.reporting_revoke_worker($1,$2)", [org, worker]],
      ["select public.reporting_reassign_worker_profile($1,$2,$3)", [org, randomUUID(), worker]],
      ["select public.reporting_import_profiles($1,$2,false)", [org, JSON.stringify([profile])]],
      ["select public.reporting_set_profile_archived($1,$2,true)", [org, profile.profile_id]],
    ] as [string, unknown[]][]) await expect(rpc(actor, sql, params)).rejects.toThrow("Only a workspace owner or admin");
  }
});
it("owners/admins can configure, while operators still see shared inventory and mappings", async () => {
  for (const actor of [owner, admin]) {
    await rpc(actor, "select public.reporting_import_profiles($1,$2,false)", [org, JSON.stringify([profile])]);
    await rpc(actor, "select public.reporting_set_profile_archived($1,$2,true)", [org, profile.profile_id]);
    await rpc(actor, "select public.reporting_set_profile_archived($1,$2,false)", [org, profile.profile_id]);
  }
  await rpc(admin, "select public.reporting_bind_worker_profile($1,$2,$3,$4,'Fixture profile')", [org, worker, customer, profile.profile_id]);
  expect(await rpc(operator, "select count(*) from public.reporting_profile_inventory where organization_id=$1", [org])).toBe(1);
  expect(await rpc(operator, "select count(*) from public.reporting_worker_profiles where organization_id=$1", [org])).toBe(1);
  expect(await rpc(operator, "select count(*) from public.reporting_customers where organization_id=$1", [org])).toBe(1);
});
it("enforces admin-only customer writes in RLS, not only the form", async () => {
  await expect(rpc(operator, "insert into public.reporting_customers(organization_id,name) values ($1,'Not permitted') returning id", [org])).rejects.toThrow();
  expect(await rpc(operator, "with changed as (update public.reporting_customers set name='Not permitted' where id=$1 returning id) select count(*) from changed", [customer])).toBe(0);
  await rpc(admin, "update public.reporting_customers set name='Updated by admin' where id=$1 returning id", [customer]);
});
it("keeps daily operator session and explicit task dispatch functional", async () => {
  await rpc(operator, "select public.reporting_session_action($1,'start','America/Los_Angeles')", [org]);
  const queued = await rpc(operator, "select public.reporting_enqueue_automation_task($1,$2,'inventory_scan','Authorized scan','{}')", [org, worker]);
  const claim = await as("", () => scalar("select public.reporting_claim_automation_task($1)", [token]), "anon") as { task_id: string };
  expect(claim.task_id).toBe(queued);
});
it("rejects an unverified owner even through the public setup wrapper", async () => {
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [owner]);
  await expect(rpc(owner, "select public.reporting_import_profiles($1,$2,false)", [org, JSON.stringify([profile])])).rejects.toThrow("Only a workspace owner or admin");
});
it("keeps internal implementations client-denied and public wrappers pinned", async () => {
  const rows = await db.query<{ schema: string; name: string; security_definer: boolean; settings: string[]; anon_ok: boolean; authenticated_ok: boolean }>(`select n.nspname as schema,p.proname as name,p.prosecdef as security_definer,p.proconfig as settings,
    has_function_privilege('anon',p.oid,'execute') as anon_ok,has_function_privilege('authenticated',p.oid,'execute') as authenticated_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private_reporting')
    and p.proname in ('reporting_register_worker','reporting_bind_worker_profile','reporting_revoke_worker','reporting_reassign_worker_profile','reporting_import_profiles','reporting_set_profile_archived')`);
  expect(rows.rows).toHaveLength(12);
  for (const row of rows.rows) {
    expect(row.security_definer).toBe(true); expect(row.settings).toContain('search_path=""');
    expect(row.anon_ok).toBe(false); expect(row.authenticated_ok).toBe(row.schema === "public");
  }
});
