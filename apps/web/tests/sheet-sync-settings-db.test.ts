import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The 2-step Sheet setup stores one read-only connector per workspace behind
// three narrow staff RPCs. Proves: staff save/read/clear, every format check
// holds at the database, non-staff (members or anonymous callers) can never
// read or write it, and the raw table is unreachable through the API roles.
const db = new PGlite();
const owner = randomUUID(), operator = randomUUID(), client = randomUUID(), outsider = randomUUID(), otherOwner = randomUUID();
let org: string, otherOrg: string;

const sheetId = "abcdefghijklmnopqrstuvwxyz-1234567890";
const endpoint = "https://script.google.com/macros/s/fixture-deployment-id/exec";
const token = "a".repeat(32);

async function scalar(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<Record<string, unknown>>(sql, params);
  return rows.length ? Object.values(rows[0])[0] : undefined;
}
async function rowsOf<T>(actor: string, sql: string, params: unknown[] = [], role = "authenticated") {
  return as(actor, async () => (await db.query<T>(sql, params)).rows, role);
}
async function as<T>(actor: string, operation: () => Promise<T>, role = "authenticated") {
  await db.exec("savepoint sheet_sync_actor");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${actor}';`);
  try {
    const value = await operation();
    await db.exec("reset role; reset request.jwt.claim.sub; release savepoint sheet_sync_actor");
    return value;
  } catch (error) {
    await db.exec("rollback to savepoint sheet_sync_actor; release savepoint sheet_sync_actor");
    throw error;
  }
}
const rpc = (actor: string, sql: string, params: unknown[] = []) => as(actor, () => scalar(sql, params));

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;`);
  for (const actor of [owner, operator, client, outsider, otherOwner]) await db.query("insert into auth.users values ($1,now())", [actor]);
  for (const name of ["202610260001_reporting_foundation.sql", "20261105220000_sheet_sync_settings.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec("begin");
  org = String(await rpc(owner, "select public.reporting_create_workspace('Sheet sync fixture')"));
  otherOrg = String(await rpc(otherOwner, "select public.reporting_create_workspace('Unrelated workspace')"));
  await db.query("insert into public.reporting_memberships values ($1,$2,'operator'),($1,$3,'customer')", [org, operator, client]);
  await db.exec("commit");
}, 120000);

afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });

const save = (actor = owner, values: [string?, string?, string?] = []) =>
  rpc(actor, "select public.reporting_save_sheet_sync($1,$2,$3,$4)", [org, values[0] ?? sheetId, values[1] ?? endpoint, values[2] ?? token]);

describe("workspace-saved Sheet connection", () => {
  it("saves once per workspace and staff reads the server-side values back", async () => {
    await save();
    const rows = await rowsOf<{ endpoint_url: string; sync_token: string }>(owner, "select endpoint_url, sync_token from public.reporting_get_sheet_sync($1)", [org]);
    expect(rows).toEqual([{ endpoint_url: endpoint, sync_token: token }]);
    // Operator-level staff can also use the saved connection, like the existing sync reads.
    expect(await rowsOf(operator, "select 1 from public.reporting_get_sheet_sync($1)", [org])).toHaveLength(1);
  });
  it("replace saves in place and never accumulates rows or echoes the old token", async () => {
    await save();
    const replacement = "b".repeat(40);
    await rpc(operator, "select public.reporting_save_sheet_sync($1,$2,$3,$4)", [org, sheetId, endpoint, replacement]);
    expect(await scalar("select count(*) from private_reporting.sheet_sync_settings")).toBe(1);
    const rows = await rowsOf<{ endpoint_url: string; sync_token: string }>(owner, "select endpoint_url, sync_token from public.reporting_get_sheet_sync($1)", [org]);
    expect(rows[0].sync_token).toBe(replacement);
    expect(rows[0].sync_token).not.toBe(token);
    // Who replaced it is recorded against the raw row (readable only to the database owner).
    expect(await scalar("select updated_by from private_reporting.sheet_sync_settings")).toBe(operator);
  });
  it("rejects customer members, outsiders and anonymous callers on every function", async () => {
    await save();
    for (const actor of [client, outsider]) {
      await expect(rpc(actor, "select public.reporting_save_sheet_sync($1,$2,$3,$4)", [org, sheetId, endpoint, token])).rejects.toThrow("Not authorized");
      await expect(rpc(actor, "select 1 from public.reporting_get_sheet_sync($1)", [org])).rejects.toThrow("Not authorized");
      await expect(rpc(actor, "select public.reporting_clear_sheet_sync($1)", [org])).rejects.toThrow("Not authorized");
    }
    // Anonymous (worker-style) transport is blocked even earlier: no EXECUTE grant at all.
    await expect(as("", () => scalar("select public.reporting_save_sheet_sync($1,$2,$3,$4)", [org, sheetId, endpoint, token]), "anon")).rejects.toThrow("permission denied");
    await expect(as("", () => scalar("select 1 from public.reporting_get_sheet_sync($1)", [org]), "anon")).rejects.toThrow("permission denied");
    // Saving is workspace-scoped: even they cannot point it at another workspace.
    await expect(rpc(client, "select public.reporting_save_sheet_sync($1,$2,$3,$4)", [otherOrg, sheetId, endpoint, token])).rejects.toThrow("Not authorized");
  });
  it("enforces sheet id, /exec endpoint and token formats at the database", async () => {
    await expect(save(owner, ["not-a-sheet"])).rejects.toThrow();
    await expect(save(owner, [undefined, "https://evil.example.com/macros/s/x/exec"])).rejects.toThrow();
    await expect(save(owner, [undefined, "https://script.google.com/macros/s/x/preview"])).rejects.toThrow();
    await expect(save(owner, [undefined, undefined, "short"])).rejects.toThrow();
    await expect(save(owner, [undefined, undefined, "has spaces not allowed here at all"])).rejects.toThrow();
    // None of the rejected attempts left a partial row behind, in either workspace.
    expect(await rowsOf(otherOwner, "select 1 from public.reporting_get_sheet_sync($1)", [otherOrg])).toHaveLength(0);
    expect(await rowsOf(owner, "select 1 from public.reporting_get_sheet_sync($1)", [org])).toHaveLength(0);
  });
  it("clearing removes only this workspace's row and read returns nothing", async () => {
    await save();
    await rpc(owner, "select public.reporting_clear_sheet_sync($1)", [org]);
    expect(await rowsOf(owner, "select 1 from public.reporting_get_sheet_sync($1)", [org])).toHaveLength(0);
    expect(await scalar("select count(*) from private_reporting.sheet_sync_settings")).toBe(0);
  });
  it("the raw table is unreachable through the API roles", async () => {
    await save();
    await expect(as("", () => scalar("select count(*) from private_reporting.sheet_sync_settings"), "anon")).rejects.toThrow();
    await expect(as(client, () => scalar("select sync_token from private_reporting.sheet_sync_settings"), "authenticated")).rejects.toThrow();
  });
});
