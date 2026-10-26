import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const client = "33333333-3333-4333-8333-333333333333";
const unverified = "44444444-4444-4444-8444-444444444444";
let orgA: string;
let orgB: string;
let customerA: string;
let customerA2: string;
let customerB: string;
let postA: string;

async function asUser<T>(user: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
  try { return await run(); } finally { await db.exec("reset role; reset request.jwt.claim.sub;"); }
}

async function scalar(sql: string, params: unknown[] = []): Promise<string> {
  const result = await db.query<Record<string, string>>(sql, params);
  return Object.values(result.rows[0])[0];
}

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ('${ownerA}', now()), ('${ownerB}', now()), ('${client}', now()), ('${unverified}', null);
  `);
  const migration = await readFile(new URL("../../../supabase/migrations/202610260001_reporting_foundation.sql", import.meta.url), "utf8");
  await db.exec(`begin;\n${migration}\ncommit;`);
  orgA = await asUser(ownerA, () => scalar("select public.reporting_create_workspace('Workspace A')"));
  orgB = await asUser(ownerB, () => scalar("select public.reporting_create_workspace('Workspace B')"));
  customerA = await asUser(ownerA, () => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Authorized customer A') returning id", [orgA]));
  customerA2 = await asUser(ownerA, () => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Other customer A') returning id", [orgA]));
  customerB = await asUser(ownerB, () => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Customer B') returning id", [orgB]));
  await asUser(ownerA, () => db.query("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [orgA, customerA, JSON.stringify([{ title: "Authorized post", url: "https://nextdoor.com/p/test-a", account_label: "Owned account", published_at: null }])]));
  postA = await scalar("select id from public.reporting_publications where customer_id = $1", [customerA]);
  await db.query("insert into public.reporting_memberships(organization_id,user_id,role) values ($1,$2,'customer')", [orgA, client]);
  await db.query("insert into public.reporting_customer_access(organization_id,user_id,customer_id) values ($1,$2,$3)", [orgA, client, customerA]);
});

afterAll(async () => { await db.close(); });

describe("real Postgres migration and reporting authorization", () => {
  it("requires verified email before creating a workspace", async () => {
    await expect(asUser(unverified, () => db.query("select public.reporting_create_workspace('Unverified workspace')"))).rejects.toThrow("Verify your email");
  });
  it("does not expose authorization helpers in the public API schema", async () => {
    const result = await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reporting_is_staff','reporting_is_member','reporting_can_view_customer')");
    expect(result.rows).toEqual([]);
  });
  it("isolates organizations at the database layer", async () => {
    const rows = await asUser(ownerB, () => db.query("select * from public.reporting_publications where id = $1", [postA]));
    expect(rows.rows).toEqual([]);
    const own = await asUser(ownerA, () => db.query("select * from public.reporting_publications where id = $1", [postA]));
    expect(own.rows).toHaveLength(1);
  });
  it("gives customer users only explicitly assigned customer records", async () => {
    const rows = await asUser(client, () => db.query<{ id: string }>("select id from public.reporting_customers"));
    expect(rows.rows.map((row) => row.id)).toEqual([customerA]);
  });
  it("does not let customer users elevate membership or create more workspaces", async () => {
    await expect(asUser(client, () => db.exec("update public.reporting_memberships set role = 'owner'"))).rejects.toThrow();
    await expect(asUser(client, () => db.query("select public.reporting_create_workspace('Escalation')"))).rejects.toThrow();
  });
  it("rejects cross-organization inserts and cross-customer foreign keys", async () => {
    await expect(asUser(ownerB, () => db.query("insert into public.reporting_customers(organization_id,name) values ($1,'Wrong org')", [orgA]))).rejects.toThrow();
    await expect(asUser(ownerA, () => db.query("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [orgA, customerB, JSON.stringify([{ title: "Wrong scope", url: "https://nextdoor.com/p/no", account_label: "Owned" }])]))).rejects.toThrow();
  });
  it("rejects unauthorized observations and direct status updates", async () => {
    await expect(asUser(ownerB, () => db.query("select public.reporting_record_observation($1,'live')", [postA]))).rejects.toThrow();
    await expect(asUser(client, () => db.query("select public.reporting_record_observation($1,'live')", [postA]))).rejects.toThrow();
    await expect(asUser(ownerA, () => db.query("update public.reporting_publications set visibility='live' where id=$1", [postA]))).rejects.toThrow();
  });
  it("atomically records manual history and the latest summary", async () => {
    await asUser(ownerA, () => db.query("select public.reporting_record_observation($1,'live',null,false,'Reviewed authorized view')", [postA]));
    const result = await asUser(ownerA, () => db.query<{ visibility: string; comments_total: number | null }>("select visibility,comments_total from public.reporting_publications where id=$1", [postA]));
    expect(result.rows[0]).toMatchObject({ visibility: "live", comments_total: null });
    const history = await asUser(client, () => db.query("select * from public.reporting_observations where publication_id=$1", [postA]));
    expect(history.rows).toHaveLength(1);
  });
  it("requires evidence for confirmed removal", async () => {
    await expect(asUser(ownerA, () => db.query("select public.reporting_record_observation($1,'confirmed_removed')", [postA]))).rejects.toThrow();
  });
  it("keeps imports unverified and deduplicates existing links", async () => {
    const records = JSON.stringify([{ title: "Imported post", url: "https://nextdoor.com/p/import", account_label: "Owned", published_at: null }]);
    const first = await asUser(ownerA, () => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'sheet_import')", [orgA, customerA, records]));
    const again = await asUser(ownerA, () => scalar("select public.reporting_add_publications($1,$2,$3::jsonb,'sheet_import')", [orgA, customerA, records]));
    expect(Number(first)).toBe(1);
    expect(Number(again)).toBe(0);
    expect(await scalar("select visibility from public.reporting_publications where url='https://nextdoor.com/p/import'")).toBe("not_checked");
  });
  it("rejects unexpected import fields and naive date timestamps", async () => {
    await expect(asUser(ownerA, () => db.query("select public.reporting_add_publications($1,$2,$3::jsonb,'sheet_import')", [orgA, customerA, JSON.stringify([{ title: "Bad field", url: "https://nextdoor.com/p/no", account_label: "Owned", password: "rejected-fixture" }])]))).rejects.toThrow();
    await expect(asUser(ownerA, () => db.query("select public.reporting_add_publications($1,$2,$3::jsonb,'sheet_import')", [orgA, customerA, JSON.stringify([{ title: "Naive time", url: "https://nextdoor.com/p/no", account_label: "Owned", published_at: "2026-01-01T10:00:00" }])]))).rejects.toThrow();
  });
  it("rejects a null import without silently treating it as a successful empty batch", async () => {
    await expect(asUser(ownerA, () => db.query("select public.reporting_add_publications($1,$2,null,'sheet_import')", [orgA, customerA]))).rejects.toThrow("Expected 1 to 100");
  });
  it("rolls back the entire import on an invalid record", async () => {
    const rows = [{ title: "Valid but rolled back", url: "https://nextdoor.com/p/rollback", account_label: "Owned" }, { title: "x", url: "https://nextdoor.com/p/invalid", account_label: "Owned" }];
    await expect(asUser(ownerA, () => db.query("select public.reporting_add_publications($1,$2,$3::jsonb,'sheet_import')", [orgA, customerA, JSON.stringify(rows)]))).rejects.toThrow();
    const result = await db.query("select id from public.reporting_publications where url='https://nextdoor.com/p/rollback'");
    expect(result.rows).toEqual([]);
  });
  it("supports one reporting session with pause/resume/end, without browser tasks", async () => {
    const start = await asUser(ownerA, () => scalar("select public.reporting_session_action($1,'start','Asia/Karachi')", [orgA]));
    const repeated = await asUser(ownerA, () => scalar("select public.reporting_session_action($1,'start','Asia/Karachi')", [orgA]));
    expect(start).toBe(repeated);
    await asUser(ownerA, () => db.query("select public.reporting_session_action($1,'pause','Asia/Karachi')", [orgA]));
    expect(await scalar("select status from public.reporting_work_sessions where id=$1", [start])).toBe("paused");
    await asUser(ownerA, () => db.query("select public.reporting_session_action($1,'resume','Asia/Karachi')", [orgA]));
    await asUser(ownerA, () => db.query("select public.reporting_session_action($1,'end','Asia/Karachi')", [orgA]));
    expect(await scalar("select status from public.reporting_work_sessions where id=$1", [start])).toBe("closed");
    await expect(asUser(client, () => db.query("select public.reporting_session_action($1,'start','Asia/Karachi')", [orgA]))).rejects.toThrow();
  });
  it("validates timezones in the database, not only the form", async () => {
    await expect(asUser(ownerA, () => db.query("insert into public.reporting_customers(organization_id,name,time_zone) values ($1,'Invalid timezone','Not/AZone')", [orgA]))).rejects.toThrow();
  });
  it("denies anonymous access", async () => {
    await db.exec("set role anon");
    try { await expect(db.query("select * from public.reporting_publications")).rejects.toThrow(); }
    finally { await db.exec("reset role"); }
  });
  it("does not expose unassigned customer comments through a join", async () => {
    const permitted = await asUser(client, () => db.query("select p.id from public.reporting_publications p join public.reporting_customers c on c.id=p.customer_id where c.id=$1", [customerA2]));
    expect(permitted.rows).toEqual([]);
  });
});
