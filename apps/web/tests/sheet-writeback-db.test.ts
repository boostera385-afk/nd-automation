import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const operator = "33333333-3333-4333-8333-333333333333", customer = "44444444-4444-4444-8444-444444444444", unverified = "55555555-5555-4555-8555-555555555555";
const intent = (rowRef: string | null = null) => ({ action: rowRef ? "update_cells" : "append", tab: "Tasks", rowRef, values: [{ "Profile Name": "Fixture profile", Status: "Filled" }] });
type OutboxRow = { id: string; status: string; attempts: number; last_error: string | null; delivery_receipt: unknown };
type ClaimedItem = { id: string; leaseToken: string; intent: unknown; attempts: number };
let org: string, foreign: string;
const scalar = async <T>(sql: string, args: unknown[] = []) => Object.values((await db.query<Record<string, unknown>>(sql, args)).rows[0])[0] as T;
async function as<T>(user: string, run: () => Promise<T>, role = "authenticated") {
  await db.exec("savepoint writeback_actor");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${user}'`);
  try { const result = await run(); await db.exec("reset role; reset request.jwt.claim.sub; release savepoint writeback_actor"); return result; }
  catch (error) { await db.exec("rollback to savepoint writeback_actor; release savepoint writeback_actor"); throw error; }
}
const enqueue = (value = intent(), stable = `fixture-${randomUUID()}`, request = randomUUID(), actor = owner, business = org) =>
  as(actor, () => scalar<{ id: string; seq: string; status: string }>("select public.reporting_enqueue_sheet_writeback_v1($1,$2::jsonb,$3,$4)", [business, JSON.stringify(value), stable, request]));
const claim = (limit = 50, request = randomUUID(), actor = owner, business = org) =>
  as(actor, () => scalar<ClaimedItem[]>("select public.reporting_claim_sheet_writeback_v1($1,$2,$3)", [business, limit, request]));
type AckOutcome = "delivered" | "conflict" | "failed" | "retry";
const ack = (item: string, lease: string, outcome: AckOutcome, receipt: unknown = null, detail: string | null = null, request = randomUUID(), actor = owner, business = org) =>
  as(actor, () => scalar<{ id: string; status: string }>("select public.reporting_ack_sheet_writeback_v1($1,$2,$3,$4,$5::jsonb,$6,$7)", [business, item, lease, outcome, receipt === null ? null : JSON.stringify(receipt), detail, request]));
const cancel = (item: string, request = randomUUID(), actor = owner, business = org) =>
  as(actor, () => scalar("select public.reporting_cancel_pending_sheet_writeback_v1($1,$2,$3)", [business, item, request]));
const freshRow = async (id: string) => (await db.query<OutboxRow>("select * from public.reporting_sheet_writeback_outbox where id=$1", [id])).rows[0];

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${owner}',now()),('${other}',now()),('${operator}',now()),('${customer}',now()),('${unverified}',null);`);
  for (const file of ["202610260001_reporting_foundation.sql", "20261029175611_sheet_writeback_v1.sql", "20261029180506_sheet_writeback_fk_indexes.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec("begin");
  org = String(await as(owner, () => scalar("select public.reporting_create_workspace('Writeback fixtures')")));
  foreign = String(await as(other, () => scalar("select public.reporting_create_workspace('Other writeback fixtures')")));
  await db.query("insert into public.reporting_memberships values ($1,$2,'operator'),($1,$3,'customer'),($1,$4,'operator')", [org, operator, customer, unverified]);
  await db.exec("commit");
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

it("enqueues a pending intent with per-organization ordering", async () => {
  const first = await enqueue(intent(), "stable-a");
  const second = await enqueue(intent(), "stable-b");
  expect(first.status).toBe("pending");
  expect(Number(second.seq)).toBeGreaterThan(Number(first.seq));
  expect((await freshRow(first.id)).status).toBe("pending");
});

it("replays lost enqueue responses and refuses changed payloads under the same request or stable key", async () => {
  const request = randomUUID();
  const first = await enqueue(intent(), "stable-replay", request);
  expect(await enqueue(intent(), "stable-replay", request)).toEqual(first);
  await expect(enqueue({ ...intent(), tab: "Different" }, "stable-replay", request)).rejects.toThrow("replay conflict");
  const lostResponse = await enqueue(intent(), "stable-second");
  expect(await enqueue(intent(), "stable-second", randomUUID())).toMatchObject({ id: lostResponse.id, status: "pending" });
  await expect(enqueue({ ...intent(), tab: "Different" }, "stable-second")).rejects.toThrow("stable key conflict");
  expect(Number(await scalar("select count(*) from public.reporting_sheet_writeback_outbox"))).toBe(2);
});

it("rejects invalid intents before any insert", async () => {
  const bad = (value: unknown, stable = `bad-${randomUUID()}`) => expect(enqueue(value as never, stable)).rejects.toThrow("Invalid writeback request");
  await bad({ action: "delete", tab: "Tasks", rowRef: null, values: [{ A: "x" }] });
  await bad({ action: "append", tab: "", rowRef: null, values: [{ A: "x" }] });
  await bad({ action: "append", tab: "Tasks", rowRef: "A2", values: [{ A: "x" }] });
  await bad({ action: "update_cells", tab: "Tasks", rowRef: null, values: [{ A: "x" }] });
  await bad({ action: "append", tab: "Tasks", rowRef: null, values: "Rows" });
  await bad({ action: "append", tab: "Tasks", rowRef: null, values: Array.from({ length: 51 }, () => ({ A: "x" })) });
  await bad({ action: "append", tab: "Tasks", rowRef: null, values: [{ [`${"k".repeat(101)}`]: "x" }] });
  await bad({ action: "append", tab: "Tasks", rowRef: null, values: [{ A: 17 }] });
  await bad({ action: "append", tab: "Tasks", rowRef: null, extra: true, values: [{ A: "x" }] });
  expect(Number(await scalar("select count(*) from public.reporting_sheet_writeback_outbox"))).toBe(0);
});

it("claims bounded ordered batches and never reissues a claimed batch", async () => {
  const a = await enqueue(intent(), "q-a"), b = await enqueue(intent(), "q-b"), c = await enqueue(intent(), "q-c");
  const request = randomUUID();
  const first = await claim(2, request);
  expect(first.map((item) => item.id)).toEqual([a.id, b.id]);
  expect(first[0].intent).toEqual(intent());
  expect((await freshRow(a.id)).status).toBe("leased");
  expect(first[0].attempts).toBe(1);
  await expect(claim(3, request)).rejects.toThrow("claim replay conflict");
  expect(await claim(2, request)).toStrictEqual(first);
  const second = await claim(2);
  expect(second.map((item) => item.id)).toEqual([c.id]);
  expect((await freshRow(c.id)).status).toBe("leased");
});

it("delivers items with lease-stamped acknowledgment and stays idempotent on lost ack responses", async () => {
  const item = await enqueue(intent(), "ack-a");
  const [leased] = await claim(1);
  await expect(ack(item.id, randomUUID(), "delivered")).rejects.toThrow("lease conflict");
  const delivered = await ack(item.id, leased.leaseToken, "delivered", { row: 7 });
  expect(delivered).toMatchObject({ status: "delivered" });
  expect((await freshRow(item.id)).delivery_receipt).toEqual({ row: 7 });
  expect(await ack(item.id, leased.leaseToken, "delivered", { row: 7 }, null, randomUUID())).toEqual(delivered);
  await expect(ack(item.id, leased.leaseToken, "retry", null, "Changed my mind")).rejects.toThrow("outcome conflict");
  await expect(ack(randomUUID(), leased.leaseToken, "delivered")).rejects.toThrow("not found");
});

it("retries transient failures without losing ordering and exhausts after five attempts", async () => {
  const item = await enqueue(intent(), "retry-flow");
  for (let round = 0; round < 5; round += 1) {
    const [leased] = await claim(1);
    expect(leased.attempts).toBe(round + 1);
    expect(await ack(item.id, leased.leaseToken, "retry", null, "Sheet busy")).toMatchObject({ status: "retry" });
    expect((await freshRow(item.id)).status).toBe("pending");
  }
  expect((await freshRow(item.id)).attempts).toBe(5);
  const exhausted = await claim(1);
  expect(exhausted).toHaveLength(0);
  expect((await freshRow(item.id)).status).toBe("failed");
  expect((await freshRow(item.id)).last_error).toBe("Attempts exhausted");
});

it("reclaims expired leases once and records terminal conflicts without rewriting history", async () => {
  const item = await enqueue(intent(), "expiry-flow");
  const [leased] = await claim(1);
  await db.query("update public.reporting_sheet_writeback_outbox set lease_expires_at=now()-interval '1 minute' where id=$1", [item.id]);
  const reclaimer = await claim(1);
  expect(reclaimer.map((entry) => entry.id)).toEqual([item.id]);
  expect(reclaimer[0].leaseToken).not.toBe(leased.leaseToken);
  expect(reclaimer[0].attempts).toBe(2);
  await expect(ack(item.id, leased.leaseToken, "delivered")).rejects.toThrow("lease conflict");
  const conflicted = await ack(item.id, reclaimer[0].leaseToken, "conflict", null, "Row moved");
  expect(conflicted).toMatchObject({ status: "conflict" });
  expect((await freshRow(item.id)).last_error).toBe("Row moved");
  await expect(ack(item.id, reclaimer[0].leaseToken, "retry")).rejects.toThrow("outcome conflict");
});

it("cancels only pending intents and denies cross-business or unverified actors", async () => {
  const oldest = await enqueue(intent(), "cancel-a");
  const newest = await enqueue(intent(), "cancel-b");
  const [lease] = await claim(1);
  expect(lease.id).toBe(oldest.id);
  await expect(cancel(oldest.id)).rejects.toThrow("Only pending");
  await expect(cancel(newest.id, randomUUID(), operator)).resolves.toMatchObject({ status: "cancelled" });
  await expect(cancel(newest.id)).rejects.toThrow("Only pending");
  const foreignItem = await enqueue(intent(), `foreign-${randomUUID()}`, randomUUID(), other, foreign);
  await expect(cancel(foreignItem.id, randomUUID(), owner, foreign)).rejects.toThrow("Verified staff required");
  await expect(enqueue(intent(), `intrude-${randomUUID()}`, randomUUID(), other, org)).rejects.toThrow("Verified staff required");
  await expect(claim(1, randomUUID(), customer)).rejects.toThrow("Verified staff required");
  await expect(enqueue(intent(), `unverified-${randomUUID()}`, randomUUID(), unverified)).rejects.toThrow("Verified staff required");
});

it("keeps tables staff-read-only and inaccessible to anon, non-staff or unverified readers", async () => {
  const item = await enqueue(intent(), "rls-a");
  expect(Number(await as(owner, () => scalar("select count(*) from public.reporting_sheet_writeback_outbox where id=$1", [item.id])))).toBe(1);
  expect(Number(await as(operator, () => scalar("select count(*) from public.reporting_sheet_writeback_outbox where id=$1", [item.id])))).toBe(1);
  expect(Number(await as(customer, () => scalar("select count(*) from public.reporting_sheet_writeback_outbox")))).toBe(0);
  expect(Number(await as(unverified, () => scalar("select count(*) from public.reporting_sheet_writeback_outbox")))).toBe(0);
  await expect(as(owner, () => db.query("update public.reporting_sheet_writeback_outbox set status='delivered'"))).rejects.toThrow();
  await expect(as(owner, () => scalar("select count(*) from public.reporting_sheet_writeback_outbox"), "anon")).rejects.toThrow();
  await expect(as(owner, () => scalar("select count(*) from public.reporting_sheet_writeback_acks"), "anon")).rejects.toThrow();
  await expect(as(owner, () => scalar("select public.reporting_enqueue_sheet_writeback_v1($1,$2::jsonb,$3,$4)", [org, JSON.stringify(intent()), `anon-${randomUUID()}`, randomUUID()]), "anon")).rejects.toThrow();
});
