import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const profile = "33333333-3333-4333-8333-333333333333";
const token = "a".repeat(64);
const otherToken = "b".repeat(64);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let org: string, otherOrg: string, customer: string, worker: string, otherWorker: string, binding: string, post: string;

async function scalar(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<Record<string, unknown>>(sql, params);
  return Object.values(rows[0])[0];
}
async function as<T>(role: "anon" | "authenticated", identity: string, run: () => Promise<T>) {
  await db.exec("savepoint worker_auth");
  await db.exec(`set role ${role}; set request.jwt.claim.sub = '${identity}';`);
  try {
    const value = await run();
    await db.exec("reset role; reset request.jwt.claim.sub; release savepoint worker_auth");
    return value;
  } catch (error) {
    await db.exec("rollback to savepoint worker_auth; release savepoint worker_auth");
    throw error;
  }
}
const owner = <T>(run: () => Promise<T>) => as("authenticated", user, run);
const agent = <T>(run: () => Promise<T>) => as("anon", "", run);
const enqueue = () => owner(() => scalar("select public.reporting_enqueue_checks($1,$2,$3::uuid[])", [org, binding, [post]]));
type Job = { job_id: string; lease_token: string; publication_id: string; profile_id: string; url: string };
const claim = (credential = token) => agent(() => scalar("select public.reporting_claim_check($1)", [credential])) as Promise<Job | null>;
const payload = { outcome: "alive", reason: "Exact post root and link observed", observed_at: new Date().toISOString(), adapter_sha256: "c".repeat(64), comments: [{ external_id: "comment-1", body: "Fixture comment" }] };
const complete = (job: Job, value: unknown = payload, lease = job.lease_token, credential = token) => agent(() => scalar("select public.reporting_complete_check($1,$2,$3,$4::jsonb)", [credential, job.job_id, lease, JSON.stringify(value)]));
async function queuedJob() { await enqueue(); return (await claim())!; }

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${user}',now()),('${other}',now());`);
  for (const file of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec("begin");
  org = String(await owner(() => scalar("select public.reporting_create_workspace('Worker workspace')")));
  otherOrg = String(await as("authenticated", other, () => scalar("select public.reporting_create_workspace('Other workspace')")));
  customer = String(await owner(() => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Authorized customer') returning id", [org])));
  worker = String(await owner(() => scalar("select public.reporting_register_worker($1,'Local PC',$2)", [org, hash(token)])));
  otherWorker = String(await as("authenticated", other, () => scalar("select public.reporting_register_worker($1,'Other PC',$2)", [otherOrg, hash(otherToken)])));
  binding = String(await owner(() => scalar("select public.reporting_bind_worker_profile($1,$2,$3,$4,'Profile A')", [org, worker, customer, profile])));
  await owner(() => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer, JSON.stringify([{ title: "Authorized test post", url: "https://nextdoor.com/p/test-post", account_label: "Profile A" }])]));
  post = String(await scalar("select id from public.reporting_publications where organization_id=$1", [org]));
  await owner(() => scalar("select public.reporting_session_action($1,'start','America/Los_Angeles')", [org]));
  await db.exec("commit");
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

describe("worker authorization and isolation", () => {
  it("includes covering indexes for all six worker bridge foreign keys flagged by the advisor", async () => {
    expect(await scalar("select count(*) from pg_indexes where schemaname='public' and indexname in ('reporting_worker_profile_worker_fk','reporting_worker_profile_session_fk','reporting_job_worker_fk','reporting_job_binding_fk','reporting_job_publication_fk','reporting_job_session_fk')")).toBe(6);
  });
  it("stores only a hash and prevents staff credential-table access", async () => {
    expect(await scalar("select token_hash from private_reporting.worker_credentials where worker_id=$1", [worker])).toBe(hash(token));
    // Permission failures abort their statement, so use savepoints around expected errors.
    await db.exec("savepoint denied");
    await expect(owner(() => scalar("select token_hash from private_reporting.worker_credentials"))).rejects.toThrow();
    await db.exec("rollback to denied");
  });
  it("rejects invalid worker credentials", async () => {
    await expect(claim("invalid")).rejects.toThrow("Invalid worker credential");
  });
  it("denies direct anonymous table access", async () => {
    await expect(agent(() => scalar("select count(*) from public.reporting_check_jobs"))).rejects.toThrow();
  });
  it("hides workers from other organizations", async () => {
    expect(await as("authenticated", other, () => scalar("select count(*) from public.reporting_workers where id=$1", [worker]))).toBe(0);
  });
  it("rejects cross-organization profile assignments", async () => {
    await expect(owner(() => scalar("select public.reporting_bind_worker_profile($1,$2,$3,$4,'Other')", [org, otherWorker, customer, profile]))).rejects.toThrow();
  });
  it("another worker cannot claim this worker's jobs", async () => {
    await enqueue();
    expect(await claim(otherToken)).toBeNull();
  });
  it("revocation denies future heartbeat calls", async () => {
    await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
    await expect(agent(() => scalar("select public.reporting_worker_heartbeat($1)", [token]))).rejects.toThrow("Invalid worker credential");
  });
  it("does not move assignments while the old worker is enabled", async () => {
    await expect(owner(() => scalar("select public.reporting_reassign_worker_profile($1,$2,$3)", [org, binding, worker]))).rejects.toThrow("Revoke the previous worker");
  });
  it("requires outstanding leases to be reconciled before moving an assignment", async () => {
    await queuedJob();
    const replacement = await owner(() => scalar("select public.reporting_register_worker($1,'Replacement',$2)", [org, hash("d".repeat(64))]));
    await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
    await expect(owner(() => scalar("select public.reporting_reassign_worker_profile($1,$2,$3)", [org, binding, replacement]))).rejects.toThrow("Reconcile outstanding leases");
  });
  it("moves a revoked worker's assignment safely without enabling monitoring", async () => {
    const replacement = await owner(() => scalar("select public.reporting_register_worker($1,'Replacement',$2)", [org, hash("d".repeat(64))]));
    await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
    await owner(() => scalar("select public.reporting_reassign_worker_profile($1,$2,$3)", [org, binding, replacement]));
    expect(await scalar("select worker_id from public.reporting_worker_profiles where id=$1", [binding])).toBe(replacement);
    expect(await scalar("select monitoring_session_id from public.reporting_worker_profiles where id=$1", [binding])).toBeNull();
  });
});

describe("durable monitoring claims", () => {
  it("does not plan automatic checks before explicit per-session authorization", async () => {
    expect(await claim()).toBeNull();
  });
  it("plans due unknown-date posts after explicit authorization without inventing publication dates", async () => {
    await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]));
    expect((await claim())?.publication_id).toBe(post);
    expect(await scalar("select published_at from public.reporting_publications where id=$1", [post])).toBeNull();
  });
  it("waits until the next customer-local day for a known publication", async () => {
    await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]));
    await db.exec("update public.reporting_publications set published_at=date_trunc('day',now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'");
    expect(await claim()).toBeNull();
    await db.exec("update public.reporting_publications set published_at=(date_trunc('day',now() at time zone 'America/Los_Angeles')-interval '1 day') at time zone 'America/Los_Angeles'");
    expect((await claim())?.publication_id).toBe(post);
  });
  it("does not automatically recheck a fresh result", async () => {
    await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]));
    await db.exec("update public.reporting_publications set last_checked_at=now()");
    expect(await claim()).toBeNull();
  });
  it("does not plan or dispatch after ten hours", async () => {
    await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,true)", [org, binding]));
    await db.exec("update public.reporting_work_sessions set started_at=now()-interval '11 hours'");
    expect(await claim()).toBeNull();
  });
  it("disabling monitoring cancels pending jobs for that binding", async () => {
    await enqueue();
    await owner(() => scalar("select public.reporting_set_profile_monitoring($1,$2,false)", [org, binding]));
    expect(await scalar("select status from public.reporting_check_jobs")).toBe("cancelled");
    expect(await claim()).toBeNull();
  });
  it("requires operator reconciliation rather than silently retrying an expired lease", async () => {
    const job = await queuedJob();
    await db.exec("update public.reporting_check_jobs set lease_expires_at=now()-interval '1 minute'");
    await owner(() => scalar("select public.reporting_reconcile_expired_check($1,$2)", [org, job.job_id]));
    expect(await scalar("select status from public.reporting_check_jobs")).toBe("cancelled");
    expect(await scalar("select lease_token from public.reporting_check_jobs")).toBeNull();
  });
  it("requires an active operator session", async () => {
    await owner(() => scalar("select public.reporting_session_action($1,'pause','America/Los_Angeles')", [org]));
    await expect(enqueue()).rejects.toThrow("Start an active work session");
  });
  it("validates every selected post against the exact customer/account binding", async () => {
    await db.query("update public.reporting_publications set account_label='Wrong profile' where id=$1", [post]);
    await expect(enqueue()).rejects.toThrow("Publication does not match");
  });
  it("deduplicates pending jobs", async () => {
    expect(await enqueue()).toBe(1);
    expect(await enqueue()).toBe(0);
  });
  it("claims exactly one job with a new lease", async () => {
    const job = await queuedJob();
    expect(job).toMatchObject({ publication_id: post, profile_id: profile, url: "https://nextdoor.com/p/test-post" });
    expect(job.lease_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await claim()).toBeNull();
  });
  it("does not dispatch after a session is paused", async () => {
    await enqueue();
    await owner(() => scalar("select public.reporting_session_action($1,'pause','America/Los_Angeles')", [org]));
    expect(await claim()).toBeNull();
  });
  it("does not automatically retry expired claims", async () => {
    await queuedJob();
    await db.exec("update public.reporting_check_jobs set lease_expires_at=now()-interval '1 minute'");
    expect(await claim()).toBeNull();
  });
  it("can cancel a pending job", async () => {
    await enqueue();
    const id = await scalar("select id from public.reporting_check_jobs");
    await owner(() => scalar("select public.reporting_cancel_pending_check($1,$2)", [org, id]));
    expect(await claim()).toBeNull();
  });
});

describe("atomic automatic results", () => {
  it("rejects observation timestamps outside the current lease window", async () => {
    await expect(complete(await queuedJob(), { ...payload, observed_at: "2000-01-01T00:00:00Z" })).rejects.toThrow("Observation time outside");
  });
  it("does not overwrite a newer manual observation summary", async () => {
    const job = await queuedJob();
    await db.query("update public.reporting_publications set visibility='unavailable',last_observed_at=now()+interval '1 minute',last_checked_at=now()+interval '1 minute',last_check_outcome='unavailable' where id=$1", [post]);
    await complete(job);
    expect(await scalar("select visibility from public.reporting_publications where id=$1", [post])).toBe("unavailable");
    expect(await scalar("select last_check_outcome from public.reporting_publications where id=$1", [post])).toBe("unavailable");
    expect(await scalar("select count(*) from public.reporting_post_checks")).toBe(1);
  });
  it("saves accurate source, observations, partial comments, notification and completion together", async () => {
    expect(await complete(await queuedJob())).toBe(true);
    expect(await scalar("select source from public.reporting_post_checks where publication_id=$1", [post])).toBe("auto_check");
    expect(await scalar("select source from public.reporting_observations where publication_id=$1", [post])).toBe("auto_check");
    expect(await scalar("select comments_complete from public.reporting_observations where publication_id=$1", [post])).toBe(false);
    expect(await scalar("select source from public.reporting_comments where publication_id=$1", [post])).toBe("auto_check");
    expect(await scalar("select visibility from public.reporting_publications where id=$1", [post])).toBe("live");
    expect(await scalar("select count(*) from public.reporting_notifications")).toBe(1);
  });
  it("makes completion replay idempotent", async () => {
    const job = await queuedJob();
    expect(await complete(job)).toBe(true);
    expect(await complete(job)).toBe(false);
    expect(await scalar("select count(*) from public.reporting_post_checks")).toBe(1);
  });
  it("rejects a different worker even with the job lease", async () => {
    await expect(complete(await queuedJob(), payload, undefined, otherToken)).rejects.toThrow("Invalid lease");
  });
  it("rejects a stale or fabricated lease", async () => {
    await expect(complete(await queuedJob(), payload, profile)).rejects.toThrow("Invalid lease");
  });
  it("rejects expired results", async () => {
    const job = await queuedJob();
    await db.exec("update public.reporting_check_jobs set lease_expires_at=now()-interval '1 minute'");
    await expect(complete(job)).rejects.toThrow("Expired or inactive lease");
  });
  it("does not convert a technical failure into a removal", async () => {
    await complete(await queuedJob(), { ...payload, outcome: "proxy_issue", comments: [] });
    expect(await scalar("select visibility from public.reporting_publications where id=$1", [post])).toBe("not_checked");
    expect(await scalar("select count(*) from public.reporting_observations")).toBe(0);
  });
  it("does not accept automatic confirmed removal", async () => {
    await expect(complete(await queuedJob(), { ...payload, outcome: "deleted_from_nd", comments: [] })).rejects.toThrow("Invalid result fields");
  });
  it("rejects malformed comments atomically", async () => {
    const job = await queuedJob();
    await db.exec("savepoint invalid_result");
    await expect(complete(job, { ...payload, comments: [{ body: "Missing stable ID" }] })).rejects.toThrow("Invalid comment");
    await db.exec("rollback to invalid_result");
    expect(await scalar("select count(*) from public.reporting_post_checks")).toBe(0);
    expect(await scalar("select status from public.reporting_check_jobs")).toBe("leased");
  });
});
