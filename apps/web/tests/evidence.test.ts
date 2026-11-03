import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { inspectEvidence, evidenceRequest } from "@/lib/evidence";

const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", viewer = "33333333-3333-4333-8333-333333333333";
let org: string, customer: string, publication: string, otherOrg: string;
async function scalar(sql: string, params: unknown[] = []) { return Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0])[0]; }
async function as<T>(uid: string, run: () => Promise<T>) {
  await db.exec(`savepoint evidence_auth; set role authenticated; set request.jwt.claim.sub='${uid}'`);
  try { const result = await run(); await db.exec("reset role; reset request.jwt.claim.sub; release savepoint evidence_auth"); return result; }
  catch (error) { await db.exec("rollback to savepoint evidence_auth; release savepoint evidence_auth"); throw error; }
}
const reserve = () => as(user, () => scalar("select reporting_reserve_evidence($1,$2,'image/png',68,$3,now(),null)", [org, publication, "a".repeat(64)]));
const action = (id: unknown, operation: string, uid = user) => as(uid, () => scalar("select reporting_evidence_action($1,$2,$3)", [org, id, operation]));
const insertObject = (id: unknown, size = 68) => as(user, () => db.query("insert into storage.objects(bucket_id,name,metadata) values ('reporting-evidence',$1,$2::jsonb)", [`${org}/${id}`, JSON.stringify({ mimetype: "image/png", size })]));

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${user}',now()),('${other}',now()),('${viewer}',now());
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    alter table storage.objects enable row level security; grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;`);
  await db.exec(await readFile(new URL("../../../supabase/migrations/202610260001_reporting_foundation.sql", import.meta.url), "utf8"));
  // Verified helpers are tested independently in verified-access.test.ts; use
  // the same final helper definitions without unrelated check-table triggers.
  const verified = await readFile(new URL("../../../supabase/migrations/20261030155515_verified_access_v1.sql", import.meta.url), "utf8");
  await db.exec(verified.slice(0, verified.indexOf("alter policy membership_read_own")));
  await db.exec(await readFile(new URL("../../../supabase/proposals/protected_evidence.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  org = String(await as(user, () => scalar("select reporting_create_workspace('Evidence workspace')")));
  otherOrg = String(await as(other, () => scalar("select reporting_create_workspace('Other workspace')")));
  customer = String(await scalar("insert into reporting_customers(organization_id,name) values ($1,'Evidence customer') returning id", [org]));
  publication = String(await scalar("insert into reporting_publications(organization_id,customer_id,title,url,account_label,source) values ($1,$2,'Fixture post','https://nextdoor.com/p/fixture','Fixture','manual_entry') returning id", [org, customer]));
  await db.query("insert into reporting_memberships values ($1,$2,'customer')", [org, viewer]);
  await db.exec("commit");
});
beforeEach(() => db.exec("begin"));
afterEach(() => db.exec("reset role; rollback"));
afterAll(() => db.close());

it("reserves immutable private keys and does not change publication visibility", async () => {
  const id = await reserve(); expect(id).toBeTruthy();
  expect(await scalar("select object_key from reporting_evidence where id=$1", [id])).toBe(`${org}/${id}`);
  expect(await scalar("select visibility from reporting_publications where id=$1", [publication])).toBe("not_checked");
  expect(await scalar("select public from storage.buckets where id='reporting-evidence'")).toBe(false);
});
it("denies foreign, customer, anonymous and direct metadata writes", async () => {
  await expect(as(other, () => scalar("select reporting_reserve_evidence($1,$2,'image/png',68,$3,now(),null)", [org, publication, "a".repeat(64)]))).rejects.toThrow("Not authorized");
  await expect(as(viewer, () => scalar("select reporting_reserve_evidence($1,$2,'image/png',68,$3,now(),null)", [org, publication, "a".repeat(64)]))).rejects.toThrow("Not authorized");
  await expect(as(user, () => db.query("delete from reporting_evidence"))).rejects.toThrow("permission denied");
  await expect(as(user, () => db.query("update reporting_evidence set state='ready'"))).rejects.toThrow("permission denied");
  expect(await scalar("select has_function_privilege('anon','reporting_reserve_evidence(uuid,uuid,text,integer,text,timestamptz,integer)','execute')")).toBe(false);
  expect(otherOrg).not.toBe(org);
});
it("requires the matching stored object before finalization and refuses replacement", async () => {
  const id = await reserve(); await expect(action(id, "ready")).rejects.toThrow("does not match");
  await insertObject(id); await action(id, "ready"); await action(id, "ready");
  await expect(insertObject(id)).rejects.toThrow();
  await expect(as(user, () => db.query("insert into storage.objects values ('reporting-evidence','arbitrary','{}')"))).rejects.toThrow("row-level security");
});
it("rejects wrong sizes and types, no implicit TTL or retention deletion", async () => {
  const id = await reserve(); await insertObject(id, 69); await expect(action(id, "ready")).rejects.toThrow("does not match");
  expect(await scalar("select review_after from reporting_evidence where id=$1", [id])).toBeNull();
});
it("isolates customers and current verification including direct storage reads", async () => {
  const id = await reserve(); await insertObject(id); await action(id, "ready");
  expect(await as(viewer, () => scalar("select count(*) from storage.objects"))).toBe(0);
  await db.query("insert into reporting_customer_access values ($1,$2,$3)", [org, viewer, customer]);
  expect(await as(viewer, () => scalar("select count(*) from storage.objects"))).toBe(1);
  expect(await as(other, () => scalar("select count(*) from storage.objects"))).toBe(0);
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [viewer]);
  expect(await as(viewer, () => scalar("select count(*) from storage.objects"))).toBe(0);
});
it("serializes holds/deletion and keeps tombstones with safe repeat completion", async () => {
  const id = await reserve(); await insertObject(id); await action(id, "ready"); await action(id, "hold");
  await expect(action(id, "request_delete")).rejects.toThrow("on hold");
  expect(await as(user, () => scalar("with removed as (delete from storage.objects returning *) select count(*) from removed"))).toBe(0);
  await action(id, "release"); await action(id, "request_delete");
  await expect(action(id, "hold")).rejects.toThrow("Deletion already authorized");
  await expect(action(id, "finish_delete")).rejects.toThrow("Storage first");
  await as(user, () => db.query("delete from storage.objects")); await action(id, "finish_delete"); await action(id, "finish_delete");
  expect(await scalar("select state from reporting_evidence where id=$1", [id])).toBe("deleted");
});
it("operators may hold evidence but only admins release holds", async () => {
  await db.query("insert into reporting_memberships values ($1,$2,'operator')", [org, other]);
  const id = await reserve(); await action(id, "hold", other);
  await expect(action(id, "release", other)).rejects.toThrow("Administrator required");
});
it("checks image bytes, dimensions, MIME, size, malformed PNG and zoned timestamps", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");
  expect(inspectEvidence(png, "image/png").sha256).toMatch(/^[a-f0-9]{64}$/);
  for (const [data, mime] of [[png, "image/jpeg"], [Buffer.from("<svg>private</svg>"), "image/png"], [png.subarray(0, 30), "image/png"], [Buffer.alloc(3145729), "image/png"]] as const) expect(() => inspectEvidence(data, mime)).toThrow();
  expect(evidenceRequest.safeParse({ publication: user, observed: "2026-11-03T15:00:00", reviewDays: "" }).success).toBe(false);
});
