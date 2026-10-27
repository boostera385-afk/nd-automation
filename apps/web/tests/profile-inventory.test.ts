import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { previewProfileCsv, profileRowSchema } from "../src/lib/profiles";

const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const customerUser = "33333333-3333-4333-8333-333333333333";
const p1 = "55555555-5555-4555-8555-555555555555";
const p2 = "66666666-6666-4666-8666-666666666666";
const row = (id = p1, name = "Profile One", group = "Team A") => ({ profile_id: id, name, group_name: group });
let org: string, otherOrg: string;
async function scalar(sql: string, params: unknown[] = []) {
  return Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0])[0];
}
async function as<T>(role: "authenticated" | "anon", uid: string, run: () => Promise<T>) {
  await db.exec("savepoint inv_auth");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${uid}'`);
  try { const result = await run(); await db.exec("reset role; reset request.jwt.claim.sub; release savepoint inv_auth"); return result; }
  catch (error) { await db.exec("rollback to savepoint inv_auth; release savepoint inv_auth"); throw error; }
}
const owner = <T>(run: () => Promise<T>) => as("authenticated", user, run);
const imp = (rows: unknown, archive: boolean | null = false, workspace = org) => owner(() => scalar("select public.reporting_import_profiles($1,$2::jsonb,$3)", [workspace, JSON.stringify(rows), archive])) as Promise<{ received: number; inserted: number; updated: number; archived: number }>;

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${user}',now()),('${other}',now()),('${customerUser}',now());`);
  for (const file of ["202610260001_reporting_foundation.sql", "202610270005_profile_inventory.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec("begin");
  org = String(await owner(() => scalar("select public.reporting_create_workspace('Inventory workspace')")));
  otherOrg = String(await as("authenticated", other, () => scalar("select public.reporting_create_workspace('Other workspace')")));
  await db.query("insert into public.reporting_memberships values ($1,$2,'customer')", [org, customerUser]);
  await db.exec("commit");
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

describe("row validation parity", () => {
  it.each([row(), row(p2, "  Padded Name  ", "G"), row(p2, "N", "Unassigned")])("accepts valid rows %# in UI and SQL", async (value) => {
    expect(profileRowSchema.safeParse(value).success).toBe(true);
    expect(await scalar("select private_reporting.valid_profile_row($1::jsonb)", [JSON.stringify(value)])).toBe(true);
  });
  it.each([null, [], {}, { profile_id: "not-a-uuid", name: "x", group_name: "y" }, { profile_id: p1, name: "ok" }, { ...row(), name: "" }, { ...row(), name: " " }, { ...row(), name: "x".repeat(201) }, { ...row(), group_name: "" }, { ...row(), group_name: "x".repeat(201) }, { ...row(), proxy: "secret" }, { ...row(), name: 3 }])("rejects invalid rows %# in UI and SQL", async (value) => {
    expect(profileRowSchema.safeParse(value).success).toBe(false);
    expect(await scalar("select private_reporting.valid_profile_row($1::jsonb)", [JSON.stringify(value)])).toBe(false);
  });
});

describe("CSV preview", () => {
  it("parses legacy-style headers and defaults group", () => {
    const { rows, errors } = previewProfileCsv(`profile_id,Name,Group\n${p1},Alpha,Team A\n${p2},Beta,`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([row(p1, "Alpha", "Team A"), row(p2, "Beta", "Unassigned")]);
  });
  it("accepts Profile Name alias", () => {
    expect(previewProfileCsv(`id,Profile Name\n${p1},Alpha`).rows[0]).toEqual(row(p1, "Alpha", "Unassigned"));
  });
  it("rejects duplicates, bad UUIDs, unknown headers and credential columns", () => {
    expect(previewProfileCsv(`profile_id,name,proxy\n${p1},A,x`).rows).toEqual([]);
    expect(previewProfileCsv(`profile_id,name\nnope,A`).errors[0]).toContain("Row 2");
    const dup = previewProfileCsv(`profile_id,name,group\n${p1},A,G\n${p1.toUpperCase()},B,G`);
    expect(dup.rows).toHaveLength(1);
    expect(dup.errors[0]).toContain("duplicate");
  });
});

describe("import RPC", () => {
  it("imports and reports accurate insert/update counts idempotently", async () => {
    expect(await imp([row()])).toMatchObject({ received: 1, inserted: 1, updated: 0, archived: 0 });
    expect(await imp([row(), row(p2, "Second", "Team B")])).toMatchObject({ received: 2, inserted: 1, updated: 1, archived: 0 });
    expect(await scalar("select count(*) from public.reporting_profile_inventory where organization_id=$1", [org])).toBe(2);
  });
  it("rejects duplicates within one payload atomically", async () => {
    await expect(imp([row(), { ...row(), name: "Other name" }])).rejects.toThrow("Duplicate profile ID");
    expect(await scalar("select count(*) from public.reporting_profile_inventory where organization_id=$1", [org])).toBe(0);
  });
  it.each([null, "{}", "[]", "[{}]", JSON.stringify([row({ profile_id: "bad" } as never)])])("rejects malformed payloads %#", async (payload) => {
    await expect(imp(payload === null ? null : JSON.parse(payload as string))).rejects.toThrow();
  });
  it("requires an explicit archive choice", async () => {
    await expect(imp([row()], null)).rejects.toThrow("Choose whether missing profiles are archived");
  });
  it("archives only missing active profiles and reactivates on re-import", async () => {
    await imp([row(), row(p2, "Second", "B")]);
    expect(await imp([row()], true)).toMatchObject({ archived: 1 });
    expect(await scalar("select status from public.reporting_profile_inventory where organization_id=$1 and profile_id=$2", [org, p2])).toBe("archived");
    expect(await imp([row(), row(p2, "Second", "B")])).toMatchObject({ archived: 0 });
    expect(await scalar("select status from public.reporting_profile_inventory where organization_id=$1 and profile_id=$2", [org, p2])).toBe("active");
  });
  it("manual archive/reactivate is explicit and idempotent-safe", async () => {
    await imp([row()]);
    await owner(() => scalar("select public.reporting_set_profile_archived($1,$2,true)", [org, p1]));
    expect(await scalar("select status from public.reporting_profile_inventory where organization_id=$1", [org])).toBe("archived");
    await expect(owner(() => scalar("select public.reporting_set_profile_archived($1,$2,true)", [org, p2]))).rejects.toThrow("Profile not found");
  });
});

describe("security and isolation", () => {
  it("enables RLS and denies anon entirely", async () => {
    expect(await scalar("select relrowsecurity from pg_class where relname='reporting_profile_inventory'")).toBe(true);
    await imp([row()]);
    await expect(as("anon", "", () => scalar("select count(*) from public.reporting_profile_inventory"))).rejects.toThrow();
    await expect(as("anon", "", () => scalar("select public.reporting_import_profiles($1,'[]'::jsonb,false)", [org]))).rejects.toThrow();
  });
  it("denies direct client writes; RPC only", async () => {
    await expect(owner(() => scalar("insert into public.reporting_profile_inventory(organization_id,profile_id,name) values($1,$2,'x') returning profile_id", [org, p1]))).rejects.toThrow();
    await expect(owner(() => scalar("delete from public.reporting_profile_inventory returning profile_id"))).rejects.toThrow();
  });
  it("hides inventory from other tenants and customer members", async () => {
    await imp([row()]);
    for (const uid of [other, customerUser]) expect(await as("authenticated", uid, () => scalar("select count(*) from public.reporting_profile_inventory"))).toBe(0);
  });
  it("denies cross-tenant import and archive", async () => {
    await imp([row()]);
    await expect(imp([row(p2, "X", "G")], false, otherOrg)).rejects.toThrow("Not authorized");
    await expect(as("authenticated", other, () => scalar("select public.reporting_set_profile_archived($1,$2,true)", [org, p1]))).rejects.toThrow("Not authorized");
  });
  it("enforces the 5000-row cap", async () => {
    const many = Array.from({ length: 5001 }, (_, i) => row(`00000000-0000-4000-8000-${String(i % 1000000000000).padStart(12, "0")}`, `P${i}`, "G"));
    await expect(imp(many)).rejects.toThrow("Import between 1 and 5000 profiles");
  });
});
