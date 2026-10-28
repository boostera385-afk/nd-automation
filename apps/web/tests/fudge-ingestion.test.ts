import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fudgeBatchSchema, fudgePayloadSchema, fudgeReviewSchema, projectFudgeCollectorReview, validateFudgeReceipts, type FudgeReceipt } from "@/lib/fudge-ingestion";

const db = new PGlite();
const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const unverifiedId = "44444444-4444-4444-8444-444444444444";
const colleagueId = "55555555-5555-4555-8555-555555555555";
const payload = { text: "Original fixture review text.", rating: 5, author: "Fixture author", business_name: "Fixture business", place_id: "fixture-place", source_url: "https://www.google.com/maps?fixture=1", photo_urls: ["https://images.example/fixture.jpg"], display_date: "A week ago" };
const review = { source: "google" as const, source_review_id: "fixture-google-review", observed_at: "2026-10-27T10:00:00Z", payload };
let org: string, otherOrg: string;
async function scalar(sql: string, params: unknown[] = []) { return Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0])[0]; }
async function as<T>(role: "anon" | "authenticated", user: string, run: () => Promise<T>) {
  await db.exec("savepoint ingestion_auth");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${user}'`);
  try { const result = await run(); await db.exec("reset role; reset request.jwt.claim.sub; release savepoint ingestion_auth"); return result; }
  catch (error) { await db.exec("rollback to savepoint ingestion_auth; release savepoint ingestion_auth"); throw error; }
}
const ingest = (reviews: unknown = [review], workspace = org, actor = ownerId) => as("authenticated", actor, () => scalar("select public.reporting_ingest_fudge_reviews_v1($1,$2::jsonb)", [workspace, JSON.stringify(reviews)])) as Promise<FudgeReceipt[]>;

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${ownerId}',now()),('${otherId}',now()),('${customerId}',now()),('${unverifiedId}',null),('${colleagueId}',now());`);
  for (const file of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql", "202610270004_content_drafts.sql", "202610270005_profile_inventory.sql"]) await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/migrations/20261028203213_fudge_ingestion_v1.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  org = String(await as("authenticated", ownerId, () => scalar("select public.reporting_create_workspace('Intake fixture workspace')")));
  otherOrg = String(await as("authenticated", otherId, () => scalar("select public.reporting_create_workspace('Other fixture workspace')")));
  await db.query("insert into public.reporting_memberships values ($1,$2,'customer'),($1,$3,'operator'),($1,$4,'operator')", [org, customerId, unverifiedId, colleagueId]);
  await db.exec("commit");
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

describe("workspace-scoped Fudge intake migration", () => {
  it("stores the original payload and returns a fully matched receipt", async () => {
    const result = await ingest();
    expect(validateFudgeReceipts([review], result)).toEqual(result);
    expect(result[0]).toMatchObject({ inserted_record: true, inserted_revision: true, revision: 1 });
    expect(await scalar("select payload from public.reporting_fudge_revisions")).toEqual(payload);
    expect(await scalar("select received_by from public.reporting_fudge_revisions")).toBe(ownerId);
  });
  it("replays identical content after a lost response without changing IDs or creating revisions", async () => {
    const first = (await ingest())[0];
    const second = (await ingest([{ ...review, observed_at: "2026-10-28T01:00:00Z" }]))[0];
    expect(second).toEqual({ ...first, inserted_record: false, inserted_revision: false });
    expect(await scalar("select count(*) from public.reporting_fudge_revisions")).toBe(1);
    expect(String(await scalar("select observed_at::text from public.reporting_fudge_revisions"))).toContain("2026-10-27");
  });
  it("appends changed content, preserves the first copy and replays old content to its original revision", async () => {
    const first = (await ingest())[0];
    const second = (await ingest([{ ...review, payload: { ...payload, text: payload.text + " Fuller recapture." } }]))[0];
    expect(second).toMatchObject({ record_id: first.record_id, revision: 2, inserted_record: false, inserted_revision: true });
    expect((await ingest())[0].revision_id).toBe(first.revision_id);
    expect(await scalar("select payload->>'text' from public.reporting_fudge_revisions where revision=1")).toBe(payload.text);
  });
  it("uses JSONB semantic content, not object-key order, for deduplication", async () => {
    await ingest();
    const reversed = Object.fromEntries(Object.entries(payload).reverse());
    expect((await ingest([{ ...review, payload: reversed }]))[0].inserted_revision).toBe(false);
  });
  it("deduplicates equivalent numeric rating representations while preserving the raw payload", async () => {
    const raw = JSON.stringify([review]).replace('"rating":5', '"rating":5.0');
    const first = await as("authenticated", ownerId, () => scalar("select public.reporting_ingest_fudge_reviews_v1($1,$2::jsonb)", [org, raw])) as FudgeReceipt[];
    expect((await ingest())[0].revision_id).toBe(first[0].revision_id);
    expect(await scalar("select payload->>'rating' from public.reporting_fudge_revisions")).toBe("5.0");
  });
  it("fails closed on a checksum collision instead of returning an unrelated payload", async () => {
    await ingest();
    // Privileged local fixture corruption simulates a collision; no client can do this.
    await db.query("update public.reporting_fudge_revisions set payload=$1::jsonb", [JSON.stringify({ ...payload, text: "Different fixture payload" })]);
    await expect(ingest()).rejects.toThrow("Payload checksum conflict");
    expect(await scalar("select count(*) from public.reporting_fudge_revisions")).toBe(1);
  });
  it("shares workspace originals with authorized colleagues rather than duplicating per uploader", async () => {
    const first = (await ingest())[0];
    expect((await ingest([review], org, colleagueId))[0].record_id).toBe(first.record_id);
    expect(await as("authenticated", colleagueId, () => scalar("select count(*) from public.reporting_fudge_revisions"))).toBe(1);
  });
  it("keeps identical external identities separate across workspaces", async () => {
    const first = (await ingest())[0];
    const other = (await ingest([review], otherOrg, otherId))[0];
    expect(other.record_id).not.toBe(first.record_id);
    expect(await as("authenticated", otherId, () => scalar("select count(*) from public.reporting_fudge_records"))).toBe(1);
  });
  it("rejects cross-tenant, customer, unverified and identity-less writes", async () => {
    await expect(ingest([review], otherOrg)).rejects.toThrow("Verified workspace staff required");
    for (const actor of [customerId, unverifiedId, ""]) await expect(ingest([review], org, actor)).rejects.toThrow("Verified workspace staff required");
    expect(await scalar("select count(*) from public.reporting_fudge_records")).toBe(0);
  });
  it("enables RLS, hides other-tenant/customer reads and denies anonymous access", async () => {
    await ingest();
    expect(await scalar("select count(*) from pg_class where relname in ('reporting_fudge_records','reporting_fudge_revisions') and relrowsecurity")).toBe(2);
    for (const actor of [otherId, customerId]) for (const table of ["reporting_fudge_records", "reporting_fudge_revisions"]) expect(await as("authenticated", actor, () => scalar(`select count(*) from public.${table}`))).toBe(0);
    await expect(as("anon", "", () => scalar("select count(*) from public.reporting_fudge_records"))).rejects.toThrow("permission denied");
    await expect(as("anon", "", () => scalar("select public.reporting_ingest_fudge_reviews_v1($1,$2::jsonb)", [org, JSON.stringify([review])]))).rejects.toThrow("permission denied");
  });
  it("revocation removes future read/write access without trusting a stale token role", async () => {
    await ingest();
    await db.query("delete from public.reporting_memberships where organization_id=$1 and user_id=$2", [org, ownerId]);
    expect(await as("authenticated", ownerId, () => scalar("select count(*) from public.reporting_fudge_revisions"))).toBe(0);
    await expect(ingest()).rejects.toThrow("Verified workspace staff required");
  });
  it("denies direct insert/update/delete even for workspace staff", async () => {
    await ingest();
    for (const table of ["reporting_fudge_records", "reporting_fudge_revisions"]) {
      for (const sql of [`insert into public.${table} default values`, `update public.${table} set id=id`, `delete from public.${table}`]) await expect(as("authenticated", ownerId, () => scalar(sql))).rejects.toThrow("permission denied");
    }
    expect(await scalar("select count(*) from public.reporting_fudge_revisions")).toBe(1);
  });
  it("confines privileged execution to the private implementation", async () => {
    expect(await scalar("select prosecdef from pg_proc where proname='reporting_ingest_fudge_reviews_v1'")).toBe(false);
    expect(await scalar("select prosecdef from pg_proc where proname='ingest_fudge_reviews_v1'")).toBe(true);
    expect(await scalar("select has_function_privilege('anon','private_reporting.ingest_fudge_reviews_v1(uuid,jsonb)','EXECUTE')")).toBe(false);
  });
  it("rolls back an entire batch when a later review fails", async () => {
    await expect(ingest([review, { ...review, source_review_id: "invalid-second", payload: { ...payload, password: "forbidden" } }])).rejects.toThrow("Invalid allowlisted source payload");
    expect(await scalar("select count(*) from public.reporting_fudge_records")).toBe(0);
    expect(await scalar("select count(*) from public.reporting_fudge_revisions")).toBe(0);
  });
  it.each([null, {}, [], Array.from({ length: 101 }, (_, i) => ({ ...review, source_review_id: `review-${i}` })), [review, review]])("rejects invalid/duplicate/count-limited batches %#", async (batch) => {
    await expect(ingest(batch)).rejects.toThrow();
    expect(await scalar("select count(*) from public.reporting_fudge_records")).toBe(0);
  });
  it.each(["", " identity ", "two words", "\t", "x".repeat(513)])("rejects unstable or malformed source identifiers %#", async (source_review_id) => {
    expect(fudgeReviewSchema.safeParse({ ...review, source_review_id }).success).toBe(false);
    await expect(ingest([{ ...review, source_review_id }])).rejects.toThrow("Stable Google review identity required");
  });
  it.each(["2026-10-27T10:00:00", "not-a-date", "2026-10-27T10:00Z", "2026-02-30T10:00:00Z", "2099-01-01T00:00:00Z"])("rejects unzoned/invalid/future observations %#", async (observed_at) => {
    expect(fudgeBatchSchema.safeParse({ version: 1, organization_id: org, reviews: [{ ...review, observed_at }] }).success).toBe(false);
    await expect(ingest([{ ...review, observed_at }])).rejects.toThrow();
  });
  it("rejects SQL's UTF-8 batch byte ceiling independently of count", async () => {
    const large = Array.from({ length: 20 }, (_, index) => ({ ...review, source_review_id: `large-${index}`, payload: { ...payload, text: "x".repeat(30000) } }));
    await expect(ingest(large)).rejects.toThrow("Batch exceeds count or byte limits");
  });
});

describe("allowlisted source payload parity", () => {
  it.each([payload, { ...payload, photo_urls: [] }, { ...payload, text: "😀".repeat(30000) }, { ...payload, rating: 1 }])("preserves allowed source data without rewriting %#", async (value) => {
    expect(fudgePayloadSchema.safeParse(value).success).toBe(true);
    expect(await scalar("select private_reporting.valid_fudge_payload($1::jsonb)", [JSON.stringify(value)])).toBe(true);
  });
  it.each([null, [], {}, { ...payload, text: "" }, { ...payload, text: " \n\t" }, { ...payload, text: "x".repeat(30001) }, { ...payload, rating: 1.5 }, { ...payload, rating: 6 }, { ...payload, rating: "5" }, { ...payload, password: "forbidden" }, { ...payload, cookies: [] }, { ...payload, author: "x".repeat(301) }, { ...payload, source_url: "http://example.test" }, { ...payload, source_url: "https://user:password@example.test" }, { ...payload, source_url: "javascript:alert(1)" }, { ...payload, photo_urls: ["http://images.example/a.jpg"] }, { ...payload, photo_urls: Array(31).fill("https://images.example/a.jpg") }])("rejects malformed/credential-bearing input %# in client and SQL", async (value) => {
    expect(fudgePayloadSchema.safeParse(value).success).toBe(false);
    expect(await scalar("select private_reporting.valid_fudge_payload($1::jsonb)", [JSON.stringify(value)])).toBe(false);
  });
});

describe("receipt and client batch acknowledgment contract", () => {
  it("rejects missing, partial, reordered, wrong-identity and extra-field responses", async () => {
    const second = { ...review, source_review_id: "second-review" };
    const results = await ingest([review, second]);
    expect(validateFudgeReceipts([review, second], results)).toEqual(results);
    for (const response of [null, {}, [], results.slice(0, 1), [...results].reverse(), [{ ...results[0], token: "unexpected" }, results[1]], [{ ...results[0], revision_id: results[1].revision_id }, results[1]]]) expect(validateFudgeReceipts([review, second], response)).toBeNull();
  });
  it("enforces strict envelope/workspace/version and a conservative client byte budget", () => {
    const batch = { version: 1, organization_id: org, reviews: [review] };
    expect(fudgeBatchSchema.safeParse(batch).success).toBe(true);
    for (const value of [{ ...batch, version: 2 }, { ...batch, organization_id: "invalid" }, { ...batch, token: "forbidden" }, { ...batch, reviews: [review, review] }, { ...batch, reviews: Array.from({ length: 10 }, (_, index) => ({ ...review, source_review_id: `large-${index}`, payload: { ...payload, text: "x".repeat(30000) } })) }]) expect(fudgeBatchSchema.safeParse(value).success).toBe(false);
  });
  it("refuses internally inconsistent new-record receipts", async () => {
    const results = await ingest();
    expect(validateFudgeReceipts([review], [{ ...results[0], inserted_revision: false }])).toBeNull();
    expect(validateFudgeReceipts([review], [{ ...results[0], revision: 2 }])).toBeNull();
  });
  it("projects only allowlisted original collector fields without mutating local data", () => {
    const local = { googleReviewId: review.source_review_id, text: payload.text, rating: payload.rating, author: payload.author, placeName: payload.business_name, placeId: payload.place_id, sourceUrl: payload.source_url, photos: payload.photo_urls, date: payload.display_date, collectedAt: review.observed_at, id: "local-id", rewrittenText: "Not original", password: "DO_NOT_UPLOAD", service: { label: "Inferred classification" } };
    expect(projectFudgeCollectorReview(local)).toEqual(review);
    expect(local.text).toBe(payload.text);
    expect(JSON.stringify(projectFudgeCollectorReview(local))).not.toContain("DO_NOT_UPLOAD");
    expect(projectFudgeCollectorReview({ ...local, googleReviewId: "", id: "fingerprint-is-not-a-Google-ID" })).toBeNull();
  });
});
