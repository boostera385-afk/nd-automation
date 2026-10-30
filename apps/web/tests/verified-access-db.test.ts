import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const db = new PGlite();
const owner = randomUUID(), operator = randomUUID(), client = randomUUID(), outsider = randomUUID();
const token = "a".repeat(64);
let org: string, customer: string, worker: string, binding: string, publication: string;
async function scalar(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<Record<string, unknown>>(sql, params);
  return Object.values(rows[0])[0];
}
async function as<T>(actor: string, operation: () => Promise<T>, role = "authenticated") {
  await db.exec("savepoint verified_actor");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${actor}';`);
  try {
    const value = await operation();
    await db.exec("reset role; reset request.jwt.claim.sub; release savepoint verified_actor");
    return value;
  } catch (error) {
    await db.exec("rollback to savepoint verified_actor; release savepoint verified_actor");
    throw error;
  }
}
const rpc = (actor: string, sql: string, params: unknown[] = []) => as(actor, () => scalar(sql, params));
const claim = () => as("", () => scalar("select public.reporting_claim_check($1)", [token]), "anon");

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;`);
  for (const actor of [owner, operator, client, outsider]) await db.query("insert into auth.users values ($1,now())", [actor]);
  for (const name of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql", "202610270004_content_drafts.sql", "202610270005_profile_inventory.sql", "20261028203213_fudge_ingestion_v1.sql", "20261029165237_service_catalog_v1.sql", "20261029175611_sheet_writeback_v1.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(await readFile(new URL("../../../supabase/migrations/20261030155515_verified_access_v1.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  org = String(await rpc(owner, "select public.reporting_create_workspace('Verified fixture')"));
  customer = String(await scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Fixture customer') returning id", [org]));
  await db.query("insert into public.reporting_memberships values ($1,$2,'operator'),($1,$3,'customer')", [org, operator, client]);
  await db.query("insert into public.reporting_customer_access values ($1,$2,$3)", [org, client, customer]);
  publication = String(await scalar("insert into public.reporting_publications(organization_id,customer_id,title,url,account_label,source) values ($1,$2,'Fixture publication','https://nextdoor.com/p/verified-fixture','Fixture profile','manual_entry') returning id", [org, customer]));
  worker = String(await rpc(owner, "select public.reporting_register_worker($1,'Fixture worker',$2)", [org, createHash("sha256").update(token).digest("hex")]));
  binding = String(await rpc(owner, "select public.reporting_bind_worker_profile($1,$2,$3,$4,'Fixture profile')", [org, worker, customer, randomUUID()]));
  await rpc(operator, "select public.reporting_session_action($1,'start','America/Los_Angeles')", [org]);
  await rpc(operator, "select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]);
  await rpc(owner, "select public.reporting_mark_notifications_seen($1)", [org]);
  await db.exec("commit");
}, 60000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

it.each([owner, operator, client])("hides legacy business reads and own access metadata after confirmation is removed (%s)", async (actor) => {
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [actor]);
  for (const table of ["reporting_organizations", "reporting_memberships", "reporting_customers", "reporting_customer_access", "reporting_publications", "reporting_workers", "reporting_worker_profiles", "reporting_work_sessions", "reporting_notification_state"]) {
    expect(await rpc(actor, `select count(*) from public.${table}`), table).toBe(0);
  }
});
it.each([owner, operator])("rejects direct legacy mutation RPCs for an unconfirmed member (%s)", async (actor) => {
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [actor]);
  await expect(rpc(actor, "select public.reporting_session_action($1,'start','America/Los_Angeles')", [org])).rejects.toThrow("Not authorized");
  await expect(rpc(actor, "select public.reporting_mark_notifications_seen($1)", [org])).rejects.toThrow("Not authorized");
  await expect(rpc(actor, "select public.reporting_register_worker($1,'Forbidden fixture',$2)", [org, "b".repeat(64)])).rejects.toThrow("Not authorized");
});
it("preserves verified staff and explicitly assigned customer reads without widening tenant scope", async () => {
  expect(await rpc(owner, "select count(*) from public.reporting_customers")).toBe(1);
  expect(await rpc(operator, "select count(*) from public.reporting_publications")).toBe(1);
  expect(await rpc(client, "select count(*) from public.reporting_customers")).toBe(1);
  expect(await rpc(client, "select count(*) from public.reporting_workers")).toBe(0);
  expect(await rpc(outsider, "select count(*) from public.reporting_customers")).toBe(0);
  await expect(rpc(client, "select public.reporting_session_action($1,'start','America/Los_Angeles')", [org])).rejects.toThrow("Not authorized");
});
it("rejects revoked membership and missing/deleted identities", async () => {
  await db.query("update public.reporting_memberships set user_id=$1 where user_id=$2", [outsider, operator]);
  expect(await rpc(operator, "select private_reporting.is_staff($1)", [org])).toBe(false);
  expect(await rpc("", "select private_reporting.is_member($1)", [org])).toBe(false);
  await db.query("delete from auth.users where id=$1", [outsider]);
  expect(await rpc(outsider, "select private_reporting.verified_human()")).toBe(false);
});
it("blocks automatic planning for an existing session whose owner is no longer confirmed", async () => {
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [operator]);
  await expect(claim()).rejects.toThrow("Verified active session owner required");
  expect(await scalar("select count(*) from public.reporting_check_jobs")).toBe(0);
});
it("blocks leasing an already pending job after its session owner loses confirmation", async () => {
  await rpc(operator, "select public.reporting_enqueue_checks($1,$2,$3::uuid[])", [org, binding, [publication]]);
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [operator]);
  await expect(claim()).rejects.toThrow("Verified active session owner required");
  expect(await scalar("select status from public.reporting_check_jobs")).toBe("pending");
});
it("preserves verified worker dispatch and allows an already leased result to drain", async () => {
  const job = await claim() as { job_id: string; lease_token: string };
  expect(job.job_id).toBeTruthy();
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [operator]);
  const result = { outcome: "needs_review", reason: "Fixture observation", observed_at: new Date().toISOString(), adapter_sha256: "b".repeat(64), comments: [] };
  expect(await as("", () => scalar("select public.reporting_complete_check($1,$2,$3,$4::jsonb)", [token, job.job_id, job.lease_token, JSON.stringify(result)]), "anon")).toBe(true);
});
it("keeps new helpers private/fixed-search-path and grants no anonymous access", async () => {
  expect(await scalar("select has_function_privilege('anon','private_reporting.verified_human()','execute')")).toBe(false);
  expect(await scalar("select has_function_privilege('authenticated','private_reporting.require_verified_check_session()','execute')")).toBe(false);
  expect(await scalar("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('verified_human','require_verified_check_session')")).toBe(0);
  const rows = await db.query<{ proconfig: string[] }>("select proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private_reporting' and p.proname in ('verified_human','require_verified_check_session')");
  expect(rows.rows.every((row) => row.proconfig.some((setting) => setting.startsWith("search_path=")))).toBe(true);
});
