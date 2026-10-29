import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const operator = "33333333-3333-4333-8333-333333333333", customer = "44444444-4444-4444-8444-444444444444", unverified = "55555555-5555-4555-8555-555555555555";
const rules = [{ keyword: "Fixture repair", searchTerm: "fixture repair", family: "Fixtures", subcategory: "Repair", businessSignals: ["fixture"], reviewSignals: ["repair"], requiredSignals: [], topicSignals: [], excludeSignals: [], topicRequired: false, collectFamilyInventory: false, rewriteServicePhrase: "fixture repair", equivalentServicePhrases: [] }];
let org: string, foreign: string;
const scalar = async (sql: string, args: unknown[] = []) => Object.values((await db.query<Record<string, unknown>>(sql, args)).rows[0])[0];
async function as<T>(user: string, run: () => Promise<T>, role = "authenticated") {
  await db.exec("savepoint catalog_actor");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${user}'`);
  try { const result = await run(); await db.exec("reset role; reset request.jwt.claim.sub; release savepoint catalog_actor"); return result; }
  catch (error) { await db.exec("rollback to savepoint catalog_actor; release savepoint catalog_actor"); throw error; }
}
const save = (value: unknown = rules, expected = 0, request = randomUUID(), actor = owner, business = org) => as(actor, () => scalar("select public.reporting_save_service_catalog_v1($1,$2::jsonb,$3,$4)", [business, JSON.stringify(value), expected, request])) as Promise<{ revisionId: string; revision: number }>;
const activate = (revision: string, expected = 0, request = randomUUID(), actor = owner, business = org) => as(actor, () => scalar("select public.reporting_activate_service_catalog_v1($1,$2,$3,$4)", [business, revision, expected, request])) as Promise<{ revisionId: string; generation: number }>;
const current = (actor = owner, business = org) => as(actor, () => scalar("select public.reporting_get_service_catalog_v1($1)", [business])) as Promise<null | { version: number; organizationId: string; generation: number; revisionId: string; revision: number; rules: unknown }>;

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${owner}',now()),('${other}',now()),('${operator}',now()),('${customer}',now()),('${unverified}',null);`);
  await db.exec(await readFile(new URL("../../../supabase/migrations/202610260001_reporting_foundation.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/migrations/20261029165237_service_catalog_v1.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/migrations/20261029165727_service_catalog_fk_indexes.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  org = String(await as(owner, () => scalar("select public.reporting_create_workspace('Catalog fixtures')")));
  foreign = String(await as(other, () => scalar("select public.reporting_create_workspace('Other catalog fixtures')")));
  await db.query("insert into public.reporting_memberships values ($1,$2,'operator'),($1,$3,'customer'),($1,$4,'operator')", [org, operator, customer, unverified]);
  await db.exec("commit");
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

it("saves an immutable staged revision without activating it", async () => {
  const result = await save(); expect(result.revision).toBe(1);
  expect(await current()).toBeNull();
  expect(await scalar("select rules from public.reporting_service_catalog_revisions")).toEqual(rules);
});
it("replays lost save responses but refuses changed payloads with the same request ID", async () => {
  const request = randomUUID(), first = await save(rules, 0, request);
  expect(await save(rules, 0, request)).toEqual(first);
  await expect(save([{ ...rules[0], family: "Changed" }], 0, request)).rejects.toThrow("replay conflict");
  expect(await scalar("select count(*) from public.reporting_service_catalog_revisions")).toBe(1);
});
it("rejects stale saves and preserves previous versions", async () => {
  await save(); await expect(save()).rejects.toThrow("version conflict");
  await save([{ ...rules[0], family: "Changed" }], 1);
  expect(await scalar("select count(*) from public.reporting_service_catalog_revisions")).toBe(2);
});
it("allows operators to stage but not activate", async () => {
  const first = await save(rules, 0, randomUUID(), operator);
  await expect(activate(first.revisionId, 0, randomUUID(), operator)).rejects.toThrow("owner or admin required");
  expect(await current(operator)).toBeNull();
});
it("activates exact revisions, replays safely and supports an explicit versioned rollback", async () => {
  const first = await save(), request = randomUUID();
  const active = await activate(first.revisionId, 0, request);
  expect(await activate(first.revisionId, 0, request)).toEqual(active);
  expect(await current()).toEqual({ version: 1, organizationId: org, generation: 1, revisionId: first.revisionId, revision: 1, rules });
  const second = await save([{ ...rules[0], family: "Changed" }], 1);
  await activate(second.revisionId, 1);
  await activate(first.revisionId, 2);
  expect(await current()).toMatchObject({ revision: 1, generation: 3, rules });
});
it("rejects stale activation and changed replay arguments", async () => {
  const first = await save(), request = randomUUID(); await activate(first.revisionId, 0, request);
  await expect(activate(first.revisionId)).rejects.toThrow("version conflict");
  await expect(activate(first.revisionId, 1, request)).rejects.toThrow("replay conflict");
});
it.each([customer, unverified, ""])("denies nonstaff/unverified/identityless access for %s", async (actor) => {
  await expect(save(rules, 0, randomUUID(), actor)).rejects.toThrow("Verified staff required");
  await expect(current(actor)).rejects.toThrow("Verified staff required");
});
it("denies cross-business access and cross-business revision activation", async () => {
  await expect(save(rules, 0, randomUUID(), owner, foreign)).rejects.toThrow("Verified staff required");
  const first = await save(), otherRevision = await save(rules, 0, randomUUID(), other, foreign);
  await expect(activate(otherRevision.revisionId)).rejects.toThrow("not found");
  await activate(first.revisionId);
  await expect(current(other)).rejects.toThrow("Verified staff required");
});
it("enforces RLS, denies direct mutations and blocks anon RPC access", async () => {
  await save();
  expect(await as(other, () => scalar("select count(*) from public.reporting_service_catalog_revisions"))).toBe(0);
  for (const sql of ["delete from public.reporting_service_catalog_revisions", "update public.reporting_service_catalog_heads set latest_revision=9", "delete from public.reporting_service_catalog_activations"]) await expect(as(owner, () => db.exec(sql))).rejects.toThrow("permission denied");
  await expect(as("", () => scalar("select public.reporting_get_service_catalog_v1($1)", [org]), "anon")).rejects.toThrow("permission denied");
});
it("rechecks membership before replaying a saved request", async () => {
  const request = randomUUID(); await save(rules, 0, request, operator);
  await db.query("delete from public.reporting_memberships where user_id=$1", [operator]);
  await expect(save(rules, 0, request, operator)).rejects.toThrow("Verified staff required");
});
it.each([[], [{ ...rules[0], topicRequired: "false" }], [{ ...rules[0], keyword: "" }], [{ ...rules[0], injected: "not allowed" }], [rules[0], { ...rules[0], keyword: "Fixture-repair," }]].map((value) => ({ value })))("rejects invalid rules atomically", async ({ value }) => {
  await expect(save(value)).rejects.toThrow();
  expect(await scalar("select count(*) from public.reporting_service_catalog_revisions")).toBe(0);
});
