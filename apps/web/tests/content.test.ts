import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contentFromForm, contentSchema, priceCents } from "../src/lib/content";

const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const customerUser = "33333333-3333-4333-8333-333333333333";
const draft = "44444444-4444-4444-8444-444444444444";
const content = { kind: "post", title: "Reviewed post", body: "Authorized fixture text", audience: "neighborhood", price_cents: null, category: null };
const listing = { ...content, kind: "listing", price_cents: 1299, category: "Requested category" };
let org: string, otherOrg: string, customer: string, worker: string, binding: string;
async function scalar(sql: string, params: unknown[] = []) {
  return Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0])[0];
}
async function as<T>(role: "authenticated" | "anon", uid: string, run: () => Promise<T>) {
  await db.exec("savepoint content_auth");
  await db.exec(`set role ${role}; set request.jwt.claim.sub='${uid}'`);
  try { const result = await run(); await db.exec("reset role; reset request.jwt.claim.sub; release savepoint content_auth"); return result; }
  catch (error) { await db.exec("rollback to savepoint content_auth; release savepoint content_auth"); throw error; }
}
const owner = <T>(run: () => Promise<T>) => as("authenticated", user, run);
const save = (revision = 0, value: unknown = content, target = binding, workspace = org) => owner(() => scalar("select public.reporting_save_content_draft($1,$2,$3,$4,$5::jsonb)", [workspace, draft, revision, target, JSON.stringify(value)]));
const review = (decision = "approve", revision = 1, confirmed: boolean | null = true) => owner(() => scalar("select public.reporting_review_content_draft($1,$2,$3,$4,$5)", [org, draft, revision, decision, confirmed]));

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values ('${user}',now()),('${other}',now()),('${customerUser}',now());`);
  for (const file of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql", "202610270004_content_drafts.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec("begin");
  org = String(await owner(() => scalar("select public.reporting_create_workspace('Content workspace')")));
  otherOrg = String(await as("authenticated", other, () => scalar("select public.reporting_create_workspace('Other workspace')")));
  customer = String(await owner(() => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Authorized customer') returning id", [org])));
  worker = String(await owner(() => scalar("select public.reporting_register_worker($1,'Local PC',$2)", [org, "a".repeat(64)])));
  binding = String(await owner(() => scalar("select public.reporting_bind_worker_profile($1,$2,$3,$4,'Exact account')", [org, worker, customer, "55555555-5555-4555-8555-555555555555"])));
  await db.query("insert into public.reporting_memberships values ($1,$2,'customer')", [org, customerUser]);
  await db.exec("commit");
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("reset role; rollback"); });
afterAll(async () => { await db.close(); });

describe("content validation", () => {
  it.each([content, listing])("accepts typed content %#", async (value) => {
    expect(contentSchema.safeParse(value).success).toBe(true);
    expect(await scalar("select private_reporting.valid_draft_content($1::jsonb)", [JSON.stringify(value)])).toBe(true);
  });
  it.each([null, [], {}, { ...content, audience: "unknown" }, { ...content, body: " " }, { ...content, title: "ab" }, { ...content, body: "x".repeat(5001) }, { ...content, password: "forbidden" }, { ...content, price_cents: 3 }, { ...listing, price_cents: -1 }, { ...listing, price_cents: 1.1 }, { ...listing, price_cents: "100" }, { ...listing, price_cents: 1000000001 }, { ...listing, category: null }, { ...listing, category: " " }])("rejects malformed content %# in UI and SQL", async (value) => {
    expect(contentSchema.safeParse(value).success).toBe(false);
    expect(await scalar("select private_reporting.valid_draft_content($1::jsonb)", [JSON.stringify(value)])).toBe(false);
    await expect(save(0, value)).rejects.toThrow("Invalid draft");
  });
  it.each([["0", 0], ["12.99", 1299], ["0.01", 1], [" 1.2 ", 120], ["10000000", 1000000000], ["1e2", null], ["-1", null], ["1.001", null], ["", null], ["1,000", null], ["10000000.01", null]])("parses price %s exactly", (value, expected) => {
    expect(priceCents(value as string)).toBe(expected);
  });
  it("builds a listing without floating-point rounding", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ kind: "listing", title: "A listing", body: "Description", audience: "nearby", price: "1.01", category: "Requested" })) form.set(key, value);
    expect(contentFromForm(form).data?.price_cents).toBe(101);
  });
});

describe("draft security and tenant isolation", () => {
  it("enables RLS on both tables", async () => {
    expect(await scalar("select count(*) from pg_class where relname in ('reporting_content_drafts','reporting_content_revisions') and relrowsecurity")).toBe(2);
  });
  it("rejects anonymous RPC execution", async () => {
    await expect(as("anon", "", () => scalar("select public.reporting_save_content_draft($1,$2,0,$3,$4::jsonb)", [org, draft, binding, JSON.stringify(content)]))).rejects.toThrow("permission denied");
  });
  it("rejects direct authenticated draft and history writes", async () => {
    await save();
    await expect(owner(() => scalar("update public.reporting_content_drafts set status='approved' returning id"))).rejects.toThrow("permission denied");
    await expect(owner(() => scalar("delete from public.reporting_content_revisions returning draft_id"))).rejects.toThrow("permission denied");
  });
  it("hides drafts and history from another tenant and customer members", async () => {
    await save();
    for (const uid of [other, customerUser]) {
      expect(await as("authenticated", uid, () => scalar("select count(*) from public.reporting_content_drafts"))).toBe(0);
      expect(await as("authenticated", uid, () => scalar("select count(*) from public.reporting_content_revisions"))).toBe(0);
    }
  });
  it("prevents staff from writing another tenant", async () => {
    await expect(save(0, content, binding, otherOrg)).rejects.toThrow("Not authorized");
  });
  it("rejects foreign profile binding", async () => {
    const foreignWorker = await as("authenticated", other, () => scalar("select public.reporting_register_worker($1,'Other PC',$2)", [otherOrg, "b".repeat(64)]));
    const foreignCustomer = await scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Other customer') returning id", [otherOrg]);
    const foreignBinding = String(await as("authenticated", other, () => scalar("select public.reporting_bind_worker_profile($1,$2,$3,$4,'Other account')", [otherOrg, foreignWorker, foreignCustomer, "66666666-6666-4666-8666-666666666666"])));
    await expect(save(0, content, foreignBinding)).rejects.toThrow("Authorized profile assignment required");
  });
  it("customer members cannot save or approve", async () => {
    await save();
    await expect(as("authenticated", customerUser, () => scalar("select public.reporting_review_content_draft($1,$2,1,'approve',true)", [org, draft]))).rejects.toThrow("Not authorized");
  });
});

describe("revision-bound review", () => {
  it("saves while no work session is active, without creating jobs or publications", async () => {
    expect(await save()).toBe(draft);
    await review();
    expect(await scalar("select status from public.reporting_content_drafts where id=$1", [draft])).toBe("approved");
    expect(await scalar("select count(*) from public.reporting_check_jobs")).toBe(0);
    expect(await scalar("select count(*) from public.reporting_publications")).toBe(0);
  });
  it("records exact content, UUID and actor snapshots", async () => {
    await save();
    expect(await scalar("select content from public.reporting_content_revisions where draft_id=$1", [draft])).toEqual(content);
    expect(await scalar("select target->>'profile_id' from public.reporting_content_revisions where draft_id=$1", [draft])).toBe("55555555-5555-4555-8555-555555555555");
    expect(await scalar("select actor_id from public.reporting_content_revisions where draft_id=$1", [draft])).toBe(user);
  });
  it("rejects replay of create without duplicate history", async () => {
    await save();
    await expect(save()).rejects.toThrow("Draft changed");
    expect(await scalar("select count(*) from public.reporting_content_revisions")).toBe(1);
  });
  it("rejects stale edits and stale approval", async () => {
    await save(); await save(1, { ...content, body: "New content" });
    await expect(save(1)).rejects.toThrow("Draft changed");
    await expect(review()).rejects.toThrow("Draft changed");
    expect(await scalar("select count(*) from public.reporting_content_revisions")).toBe(2);
  });
  it.each([false, null])("requires explicit confirmation: %s", async (confirmed) => {
    await save(); await expect(review("approve", 1, confirmed)).rejects.toThrow("Explicit review confirmation required");
  });
  it("cannot edit an approved revision; return invalidates approval", async () => {
    await save(); await review();
    await expect(save(2)).rejects.toThrow("Return approved content");
    await review("return", 2);
    expect(await scalar("select approved_at from public.reporting_content_drafts where id=$1", [draft])).toBeNull();
    await save(3, listing);
    expect(await scalar("select revision from public.reporting_content_drafts where id=$1", [draft])).toBe(4);
    expect(await scalar("select content from public.reporting_content_revisions where draft_id=$1 and revision=1", [draft])).toEqual(content);
  });
  it("cannot approve twice or return unapproved content", async () => {
    await save(); await expect(review("return")).rejects.toThrow("Invalid review transition");
    await review(); await expect(review("approve", 2)).rejects.toThrow("Invalid review transition");
  });
  it("archives without deleting history or permitting further edits", async () => {
    await save(); await review("archive");
    await expect(save(2)).rejects.toThrow("Return approved content");
    await expect(review("approve", 2)).rejects.toThrow("Invalid review transition");
    expect(await scalar("select count(*) from public.reporting_content_revisions")).toBe(2);
  });
  it("blocks approval after worker revocation", async () => {
    await save();
    await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
    await expect(review()).rejects.toThrow("Worker unavailable");
    // Return/archive remains possible even when the worker is unavailable.
    await review("archive");
  });
  it("requires a new saved snapshot after worker reassignment", async () => {
    await save();
    const replacement = await owner(() => scalar("select public.reporting_register_worker($1,'Replacement PC',$2)", [org, "c".repeat(64)]));
    await owner(() => scalar("select public.reporting_revoke_worker($1,$2)", [org, worker]));
    await owner(() => scalar("select public.reporting_reassign_worker_profile($1,$2,$3)", [org, binding, replacement]));
    await expect(review()).rejects.toThrow("Assignment changed");
    await save(1); await review("approve", 2);
    expect(await scalar("select target->>'worker_id' from public.reporting_content_revisions where draft_id=$1 and revision=3", [draft])).toBe(replacement);
  });
});
