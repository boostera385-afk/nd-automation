import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { cohortReceiptSchema, cohortReportSchema, cohortProgress } from "@/lib/check-cohort";

const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", unverified = "33333333-3333-4333-8333-333333333333", customerUser = "44444444-4444-4444-8444-444444444444";
const token = "a".repeat(64);
let org: string, otherOrg: string, customer: string, worker: string, binding: string, day: string;
async function scalar(sql: string, params: unknown[] = []) { const { rows } = await db.query<Record<string, unknown>>(sql, params); return Object.values(rows[0])[0]; }
async function as<T>(role: "authenticated" | "anon", actor: string, operation: () => Promise<T>) {
  await db.exec("savepoint cohort_auth");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${actor}';`);
  try { const value = await operation(); await db.exec("reset role; reset request.jwt.claim.sub; release savepoint cohort_auth"); return value; }
  catch (error) { await db.exec("rollback to savepoint cohort_auth; release savepoint cohort_auth"); throw error; }
}
const owner = <T>(operation: () => Promise<T>) => as("authenticated", user, operation);
const refresh = (id = randomUUID(), options: { org?: string; customer?: string; day?: string; kind?: string; freshness?: number } = {}) => owner(() => scalar("select public.reporting_refresh_check_cohort_v1($1,$2,$3::date,$4,$5,$6)", [options.org ?? org, options.customer ?? customer, options.day ?? day, options.kind ?? "posts", options.freshness ?? 60, id]));
const report = (id: string, organization = org) => owner(() => scalar("select public.reporting_get_check_cohort_v1($1,$2)", [organization, id]));
async function seed(count: number, label = "Fixture profile", kind = "p", date: string | null = day) {
  await db.query(`insert into public.reporting_publications(organization_id,customer_id,title,url,account_label,published_at,source)
    select $1,$2,'Fixture publication','https://nextdoor.com/'||$5||'/fixture-'||$6||'-'||i,$3,
      case when $4::date is null then null else ($4::date+time '12:00') at time zone 'America/Los_Angeles' end,'manual_entry'
      from generate_series(1,$7::integer) i`, [org, customer, label, date, kind, randomUUID(), count]);
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${user}',now()),('${other}',now()),('${unverified}',null),('${customerUser}',now());`);
  for (const name of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql"]) await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/drafts/check_cohort_v1.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  org = String(await owner(() => scalar("select public.reporting_create_workspace('Fixture workspace')")));
  otherOrg = String(await as("authenticated", other, () => scalar("select public.reporting_create_workspace('Other fixture')")));
  customer = String(await scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Fixture customer') returning id", [org]));
  await db.query("insert into public.reporting_memberships(organization_id,user_id,role) values ($1,$2,'operator'),($1,$3,'customer')", [org, unverified, customerUser]);
  worker = String(await owner(() => scalar("select public.reporting_register_worker($1,'Fixture worker',$2)", [org, createHash("sha256").update(token).digest("hex")])));
  binding = String(await owner(() => scalar("select public.reporting_bind_worker_profile($1,$2,$3,$4,'Fixture profile')", [org, worker, customer, randomUUID()])));
  await owner(() => scalar("select public.reporting_session_action($1,'start','America/Los_Angeles')", [org]));
  await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]));
  day = String(await scalar("select to_char((clock_timestamp() at time zone 'America/Los_Angeles')::date-1,'YYYY-MM-DD')"));
  await db.exec("commit");
}, 60000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

it("snapshots 100 exact publications and creates one durable job each without browser work", async () => {
  await seed(100);
  const receipt = cohortReceiptSchema.parse(await refresh());
  expect(receipt).toMatchObject({ total: 100, queued: 100, active: 0, recent: 0, blocked: 0, unknownDates: 0, policyVersion: 1 });
  expect(await scalar("select count(*) from public.reporting_check_jobs")).toBe(100);
  const saved = cohortReportSchema.parse(await report(receipt.cohortId));
  expect(saved.items).toHaveLength(100); expect(cohortProgress(saved).waiting).toBe(100);
});
it("replays the exact request after session end without changing the snapshot or queue", async () => {
  await seed(2); const id = randomUUID(); const first = await refresh(id);
  await owner(() => scalar("select public.reporting_session_action($1,'end','America/Los_Angeles')", [org]));
  await seed(1);
  expect(await refresh(id)).toEqual(first);
  expect(await scalar("select count(*) from public.reporting_check_jobs")).toBe(2);
});
it("new request IDs reuse active jobs rather than duplicate double-clicks", async () => {
  await seed(3); await refresh();
  expect(cohortReceiptSchema.parse(await refresh())).toMatchObject({ total: 3, queued: 0, active: 3 });
  expect(await scalar("select count(*) from public.reporting_check_jobs")).toBe(3);
});
it("reuses scheduled jobs already planned by the original worker RPC", async () => {
  await seed(3);
  const claimed = await as("anon", "", () => scalar("select public.reporting_claim_check($1)", [token])); expect(claimed).not.toBeNull();
  expect(cohortReceiptSchema.parse(await refresh())).toMatchObject({ queued: 0, active: 3 });
});
it("keeps active jobs in the snapshot and reports completed/partial/attention outcomes honestly", async () => {
  await seed(1); const receipt = cohortReceiptSchema.parse(await refresh());
  const job = await as("anon", "", () => scalar("select public.reporting_claim_check($1)", [token])) as { job_id: string; lease_token: string };
  let saved = cohortReportSchema.parse(await report(receipt.cohortId)); expect(cohortProgress(saved).running).toBe(1);
  await as("anon", "", () => scalar("select public.reporting_complete_check($1,$2,$3,$4::jsonb)", [token, job.job_id, job.lease_token, JSON.stringify({ outcome: "proxy_issue", reason: "Fixture proxy problem", observed_at: new Date().toISOString(), adapter_sha256: "b".repeat(64), comments: [] })]));
  saved = cohortReportSchema.parse(await report(receipt.cohortId));
  expect(cohortProgress(saved)).toMatchObject({ checked: 1, attention: 1, waiting: 0 });
  expect(await scalar("select visibility from public.reporting_publications")).toBe("not_checked");
});
it("distinguishes explicit one-hour freshness from unchanged scheduled 24-hour suppression", async () => {
  await seed(1); await db.exec("update public.reporting_publications set last_checked_at=now()-interval '2 hours',last_check_outcome='alive'");
  expect(await as("anon", "", () => scalar("select public.reporting_claim_check($1)", [token]))).toBeNull();
  expect(cohortReceiptSchema.parse(await refresh())).toMatchObject({ queued: 1, recent: 0 });
});
it("reports fresh results as recent, and allows only bounded configurable freshness", async () => {
  await seed(1); await db.exec("update public.reporting_publications set last_checked_at=now()-interval '2 hours',last_check_outcome='alive'");
  const receipt = cohortReceiptSchema.parse(await refresh(randomUUID(), { freshness: 240 }));
  expect(receipt).toMatchObject({ queued: 0, recent: 1, freshnessMinutes: 240 });
  expect(cohortProgress(cohortReportSchema.parse(await report(receipt.cohortId))).recent).toBe(1);
  for (const freshness of [0, 59, 1441]) await expect(refresh(randomUUID(), { freshness })).rejects.toThrow("Invalid cohort request");
});
it("accepts a first prior-business-day check even when publication is less than 24 hours old", async () => {
  await seed(1);
  await db.query("update public.reporting_publications set published_at=($1::date+time '23:59:59') at time zone 'America/Los_Angeles'", [day]);
  expect(cohortReceiptSchema.parse(await refresh())).toMatchObject({ total: 1, queued: 1 });
});
it("excludes unknown-date and other-date rows rather than replacing cohort members", async () => {
  await seed(2); await seed(3, "Fixture profile", "p", null);
  await seed(1, "Fixture profile", "p", "2000-01-01");
  const receipt = cohortReceiptSchema.parse(await refresh());
  expect(receipt).toMatchObject({ total: 2, unknownDates: 3, queued: 2 });
  expect(await scalar("select count(*) from public.reporting_check_cohort_items")).toBe(2);
});
it("does not silently include listings in a post cohort; both is an explicit choice", async () => {
  await seed(2); await seed(3, "Fixture profile", "for_sale_and_free");
  expect(cohortReceiptSchema.parse(await refresh()).total).toBe(2);
  expect(cohortReceiptSchema.parse(await refresh(randomUUID(), { kind: "listings" })).total).toBe(3);
  expect(cohortReceiptSchema.parse(await refresh(randomUUID(), { kind: "both" }))).toMatchObject({ total: 5, active: 5 });
});
it("does not enable an unmapped or unauthorized profile", async () => {
  await seed(1, "Unmapped fixture"); await seed(1);
  await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,false)", [org, binding]));
  expect(cohortReceiptSchema.parse(await refresh())).toMatchObject({ total: 2, queued: 0, blocked: 2 });
  expect(await scalar("select count(*) from public.reporting_check_jobs")).toBe(0);
  expect(await scalar("select monitoring_session_id from public.reporting_worker_profiles")).toBeNull();
});
it("reports disabled workers rather than pretending to queue executable jobs", async () => {
  await seed(1); await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
  const receipt = cohortReceiptSchema.parse(await refresh());
  expect(receipt.blocked).toBe(1);
  expect(cohortReportSchema.parse(await report(receipt.cohortId)).items[0].disposition).toBe("worker_unavailable");
});
it("keeps unsupported worker URLs out of execution without changing them", async () => {
  await seed(1); await db.exec("update public.reporting_publications set url='https://nextdoor.co.uk/p/fixture'");
  const receipt = cohortReceiptSchema.parse(await refresh());
  expect(cohortReportSchema.parse(await report(receipt.cohortId)).items[0]).toMatchObject({ disposition: "unsupported_link", url: "https://nextdoor.co.uk/p/fixture", jobId: null });
});
it.each(["pause", "end", "expired"])("refuses new requests when the authorizing session is %s", async (mode) => {
  await seed(1);
  if (mode === "expired") await db.exec("update public.reporting_work_sessions set started_at=now()-interval '11 hours'");
  else await owner(() => scalar("select public.reporting_session_action($1,$2,'America/Los_Angeles')", [org, mode]));
  await expect(refresh()).rejects.toThrow("Start an active work session");
  expect(await scalar("select count(*) from public.reporting_check_cohorts")).toBe(0);
});
it("never reclaims an expired lease through refresh; progress requires reconciliation", async () => {
  await seed(1); await refresh();
  await as("anon", "", () => scalar("select public.reporting_claim_check($1)", [token]));
  await db.exec("update public.reporting_check_jobs set lease_expires_at=now()-interval '1 minute'");
  const receipt = cohortReceiptSchema.parse(await refresh());
  expect(receipt.active).toBe(1);
  expect(cohortProgress(cohortReportSchema.parse(await report(receipt.cohortId))).attention).toBe(1);
  expect(await scalar("select count(*) from public.reporting_check_jobs")).toBe(1);
});
it("does not alter frozen membership after later publication edits or new imports", async () => {
  await seed(1); const receipt = cohortReceiptSchema.parse(await refresh());
  const before = cohortReportSchema.parse(await report(receipt.cohortId));
  await db.exec("update public.reporting_publications set account_label='Changed fixture',published_at=null"); await seed(1);
  const after = cohortReportSchema.parse(await report(receipt.cohortId)); expect(after.items).toEqual(before.items);
});
it("refuses changed payload or actor replay", async () => {
  await seed(1); const id = randomUUID(); await refresh(id);
  for (const options of [{ kind: "both" }, { freshness: 120 }, { day: "2000-01-01" }]) await expect(refresh(id, options)).rejects.toThrow("Cohort replay conflict");
  await db.query("insert into public.reporting_memberships values ($1,$2,'operator')", [org, other]);
  await expect(as("authenticated", other, () => scalar("select public.reporting_refresh_check_cohort_v1($1,$2,$3::date,'posts',60,$4)", [org, customer, day, id]))).rejects.toThrow("Cohort replay conflict");
});
it.each([unverified, customerUser, other, ""])("denies unverified, customer, cross-business and missing actors (%s)", async (actor) => {
  await expect(as("authenticated", actor, () => scalar("select public.reporting_refresh_check_cohort_v1($1,$2,$3::date,'posts',60,$4)", [org, customer, day, randomUUID()]))).rejects.toThrow("Verified staff required");
});
it("denies cross-business customers, reads and revoked memberships", async () => {
  await seed(1); const receipt = cohortReceiptSchema.parse(await refresh());
  await expect(refresh(randomUUID(), { org: otherOrg })).rejects.toThrow("Verified staff required");
  await expect(refresh(randomUUID(), { customer: randomUUID() })).rejects.toThrow("Customer unavailable");
  expect(await as("authenticated", other, () => scalar("select count(*) from public.reporting_check_cohorts"))).toBe(0);
  await db.query("delete from public.reporting_memberships where organization_id=$1 and user_id=$2", [org, user]);
  await expect(report(receipt.cohortId)).rejects.toThrow("Verified staff required");
});
it("denies anonymous RPCs and direct mutation of snapshot tables", async () => {
  await expect(as("anon", "", () => scalar("select public.reporting_refresh_check_cohort_v1($1,$2,$3::date,'posts',60,$4)", [org, customer, day, randomUUID()]))).rejects.toThrow();
  await expect(owner(() => scalar("delete from public.reporting_check_cohorts returning id"))).rejects.toThrow();
  await expect(owner(() => scalar("update public.reporting_check_cohort_items set disposition='recent' returning cohort_id"))).rejects.toThrow();
});
it("allows a verified operator only with that operator's active session and explicit profile authorization", async () => {
  await seed(1);
  await db.query("insert into public.reporting_memberships values ($1,$2,'operator')", [org, other]);
  await as("authenticated", other, () => scalar("select public.reporting_session_action($1,'start','America/Los_Angeles')", [org]));
  await as("authenticated", other, () => scalar("select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]));
  const receipt = await as("authenticated", other, () => scalar("select public.reporting_refresh_check_cohort_v1($1,$2,$3::date,'posts',60,$4)", [org, customer, day, randomUUID()]));
  expect(cohortReceiptSchema.parse(receipt)).toMatchObject({ total: 1, queued: 1 });
});
it("rate limits new IDs, but not a safe replay", async () => {
  const id = randomUUID(); await refresh(id);
  for (let i = 0; i < 5; i++) await refresh();
  await expect(refresh()).rejects.toThrow("Cohort request rate limit");
  expect(cohortReceiptSchema.safeParse(await refresh(id)).success).toBe(true);
});
it("rejects today/future dates and oversized cohorts atomically", async () => {
  const today = String(await scalar("select to_char((clock_timestamp() at time zone 'America/Los_Angeles')::date,'YYYY-MM-DD')"));
  await expect(refresh(randomUUID(), { day: today })).rejects.toThrow("Choose a prior business date");
  await seed(501); await expect(refresh()).rejects.toThrow("Cohort exceeds 500");
  expect(await scalar("select count(*) from public.reporting_check_cohorts")).toBe(0);
  expect(await scalar("select count(*) from public.reporting_check_jobs")).toBe(0);
});
it.each([["2026-03-08", 23], ["2025-11-02", 25]] as const)("uses exact DST-aware business boundaries for %s", async (date, hours) => {
  await seed(4, "Fixture profile", "p", date);
  const span = Number(await scalar("select extract(epoch from (($1::date+1)::timestamp at time zone 'America/Los_Angeles')-($1::date::timestamp at time zone 'America/Los_Angeles'))/3600", [date]));
  expect(span).toBe(hours);
  await db.query(`with positions as (select id,row_number() over(order by id) as n from public.reporting_publications)
    update public.reporting_publications p set published_at=case positions.n
      when 1 then $1::date::timestamp at time zone 'America/Los_Angeles'
      when 2 then (($1::date+1)::timestamp at time zone 'America/Los_Angeles')-interval '1 millisecond'
      when 3 then ($1::date+1)::timestamp at time zone 'America/Los_Angeles'
      else ($1::date::timestamp at time zone 'America/Los_Angeles')-interval '1 millisecond' end
      from positions where positions.id=p.id`, [date]);
  expect(cohortReceiptSchema.parse(await refresh(randomUUID(), { day: date }))).toMatchObject({ total: 2, queued: 2 });
});
