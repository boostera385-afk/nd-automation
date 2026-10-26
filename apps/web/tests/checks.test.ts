import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECK_OUTCOMES, checkOutcomes, needsCheck } from "@/lib/checks";

const db = new PGlite();
const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const client = "33333333-3333-4333-8333-333333333333";
const otherClient = "55555555-5555-4555-8555-555555555555";
let orgA: string;
let orgB: string;
let customerA: string;
let customerA2: string;
let customerB: string;
const posts: string[] = [];
let post2: string;
let postB: string;

async function asUser<T>(user: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
  try { return await run(); } finally { await db.exec("reset role; reset request.jwt.claim.sub;"); }
}
async function scalar(sql: string, params: unknown[] = []): Promise<string> {
  const result = await db.query<Record<string, unknown>>(sql, params);
  return String(Object.values(result.rows[0])[0]);
}
const record = (user: string, org: string, checks: unknown, notes = "") => asUser(user, () => db.query<Record<string, unknown>>("select public.reporting_record_checks($1,$2::jsonb,$3)", [org, JSON.stringify(checks), notes]));
const addPost = async (user: string, org: string, customer: string, slug: string) => {
  await asUser(user, () => db.query("select public.reporting_add_publications($1,$2,$3::jsonb,'manual_entry')", [org, customer, JSON.stringify([{ title: `Post ${slug}`, url: `https://nextdoor.com/p/${slug}`, account_label: `Profile ${slug}` }])]));
  return scalar("select id from public.reporting_publications where url = $1", [`https://nextdoor.com/p/${slug}`]);
};

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ('${ownerA}', now()), ('${ownerB}', now()), ('${client}', now()), ('${otherClient}', now());
  `);
  for (const file of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql"]) {
    const sql = await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8");
    await db.exec(`begin;\n${sql}\ncommit;`);
  }
  orgA = await asUser(ownerA, () => scalar("select public.reporting_create_workspace('Workspace A')"));
  orgB = await asUser(ownerB, () => scalar("select public.reporting_create_workspace('Workspace B')"));
  customerA = await asUser(ownerA, () => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Customer A') returning id", [orgA]));
  customerA2 = await asUser(ownerA, () => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Customer A2') returning id", [orgA]));
  customerB = await asUser(ownerB, () => scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Customer B') returning id", [orgB]));
  for (const slug of ["a1", "a2", "a3", "a4", "a5"]) posts.push(await addPost(ownerA, orgA, customerA, slug));
  post2 = await addPost(ownerA, orgA, customerA2, "other-customer");
  postB = await addPost(ownerB, orgB, customerB, "b1");
  await db.query("insert into public.reporting_memberships(organization_id,user_id,role) values ($1,$2,'customer'), ($1,$3,'customer')", [orgA, client, otherClient]);
  await db.query("insert into public.reporting_customer_access(organization_id,user_id,customer_id) values ($1,$2,$3)", [orgA, client, customerA]);
});
afterAll(async () => { await db.close(); });

describe("outcome table agrees with the database", () => {
  it.each(CHECK_OUTCOMES)("%s has the same tone, headline and visibility in SQL and in the app", async (outcome) => {
    const row = (await db.query<{ tone: string; headline: string; new_visibility: string | null }>("select * from private_reporting.check_outcome_info($1)", [outcome])).rows[0];
    expect(row.tone).toBe(checkOutcomes[outcome].tone);
    expect(row.headline).toBe(checkOutcomes[outcome].headline);
    expect(row.new_visibility).toBe(checkOutcomes[outcome].visibility);
  });
  it("treats an unknown outcome as invalid", async () => {
    expect((await db.query<{ tone: string | null }>("select tone from private_reporting.check_outcome_info('made_up')")).rows[0].tone).toBeNull();
  });
});

describe("recording a single check", () => {
  it("an alive result updates the summary, history, check and notification together", async () => {
    await record(ownerA, orgA, [{ publication_id: posts[0], outcome: "alive", comments_total: 4 }], "Opened from the owning profile");
    const post = (await db.query<{ visibility: string; last_check_outcome: string; last_checked_at: string; last_observed_at: string; comments_total: number }>("select visibility,last_check_outcome,last_checked_at,last_observed_at,comments_total from public.reporting_publications where id=$1", [posts[0]])).rows[0];
    expect(post).toMatchObject({ visibility: "live", last_check_outcome: "alive", comments_total: 4 });
    expect(post.last_observed_at).toBeTruthy();
    const check = (await db.query<{ tone: string; message: string; observation_id: string | null; source: string }>("select tone,message,observation_id,source from public.reporting_post_checks where publication_id=$1", [posts[0]])).rows[0];
    expect(check).toMatchObject({ tone: "positive", message: "Post is alive", source: "manual_review" });
    expect(check.observation_id).toBeTruthy();
    expect(await scalar("select count(*) from public.reporting_observations where publication_id=$1", [posts[0]])).toBe("1");
    const note = (await db.query<{ kind: string; tone: string; title: string; message: string; publication_id: string }>("select kind,tone,title,message,publication_id from public.reporting_notifications where publication_id=$1", [posts[0]])).rows[0];
    expect(note).toMatchObject({ kind: "check_result", tone: "positive", title: "Post is alive", publication_id: posts[0] });
    expect(note.message).toContain("Post a1");
  });

  it("a proxy issue never changes visibility or the observation time", async () => {
    await record(ownerA, orgA, [{ publication_id: posts[0], outcome: "proxy_issue" }]);
    const post = (await db.query<{ visibility: string; last_check_outcome: string }>("select visibility,last_check_outcome from public.reporting_publications where id=$1", [posts[0]])).rows[0];
    expect(post).toEqual({ visibility: "live", last_check_outcome: "proxy_issue" });
    expect(await scalar("select count(*) from public.reporting_observations where publication_id=$1", [posts[0]])).toBe("1");
    const note = await scalar("select tone from public.reporting_notifications where publication_id=$1 order by created_at desc limit 1", [posts[0]]);
    expect(note).toBe("attention");
  });

  it("a failed attempt on a never-checked post leaves it not_checked", async () => {
    await record(ownerA, orgA, [{ publication_id: posts[1], outcome: "login_required" }]);
    const post = (await db.query<{ visibility: string; last_observed_at: string | null; last_checked_at: string }>("select visibility,last_observed_at,last_checked_at from public.reporting_publications where id=$1", [posts[1]])).rows[0];
    expect(post.visibility).toBe("not_checked");
    expect(post.last_observed_at).toBeNull();
    expect(post.last_checked_at).toBeTruthy();
  });

  it("removal needs written evidence, then confirms removal", async () => {
    await expect(record(ownerA, orgA, [{ publication_id: posts[2], outcome: "deleted_from_nd" }])).rejects.toThrow("Explicit removal evidence");
    await expect(record(ownerA, orgA, [{ publication_id: posts[2], outcome: "deleted_from_nd" }], "short")).rejects.toThrow("Explicit removal evidence");
    await record(ownerA, orgA, [{ publication_id: posts[2], outcome: "deleted_from_nd" }], "Nextdoor showed: this post was removed");
    expect(await scalar("select visibility from public.reporting_publications where id=$1", [posts[2]])).toBe("confirmed_removed");
    expect(await scalar("select tone from public.reporting_post_checks where publication_id=$1", [posts[2]])).toBe("negative");
  });
});

describe("recording a batch", () => {
  it("records every item and creates ONE summary notification with honest counts", async () => {
    const before = Number(await scalar("select count(*) from public.reporting_notifications where kind='check_batch'"));
    const count = await record(ownerA, orgA, [{ publication_id: posts[3], outcome: "alive" }, { publication_id: posts[4], outcome: "proxy_issue" }]);
    expect(Object.values(count.rows[0])[0]).toBe(2);
    expect(await scalar("select count(*) from public.reporting_post_checks where publication_id in ($1,$2)", [posts[3], posts[4]])).toBe("2");
    expect(Number(await scalar("select count(*) from public.reporting_notifications where kind='check_batch'"))).toBe(before + 1);
    const note = (await db.query<{ tone: string; title: string; message: string; publication_id: string | null; check_count: number }>("select tone,title,message,publication_id,check_count from public.reporting_notifications where kind='check_batch' order by created_at desc limit 1")).rows[0];
    expect(note).toMatchObject({ tone: "attention", title: "2 post checks recorded", publication_id: null, check_count: 2 });
    expect(note.message).toBe("1 alive · 0 removed or not accessible · 1 need attention");
  });

  it("is all-or-nothing: one bad item records nothing", async () => {
    const before = await scalar("select count(*) from public.reporting_post_checks");
    await expect(record(ownerA, orgA, [{ publication_id: posts[3], outcome: "alive" }, { publication_id: "99999999-9999-4999-8999-999999999999", outcome: "alive" }])).rejects.toThrow("Post not found");
    expect(await scalar("select count(*) from public.reporting_post_checks")).toBe(before);
  });

  it("rejects duplicates, unknown outcomes, unknown fields, empty and oversized batches", async () => {
    await expect(record(ownerA, orgA, [{ publication_id: posts[3], outcome: "alive" }, { publication_id: posts[3], outcome: "alive" }])).rejects.toThrow("only once");
    await expect(record(ownerA, orgA, [{ publication_id: posts[3], outcome: "made_up" }])).rejects.toThrow("Invalid outcome");
    await expect(record(ownerA, orgA, [{ publication_id: posts[3], outcome: "alive", visibility: "live" }])).rejects.toThrow("Unexpected check fields");
    await expect(record(ownerA, orgA, [])).rejects.toThrow("Expected 1 to 100");
    await expect(asUser(ownerA, () => db.query("select public.reporting_record_checks($1,null)", [orgA]))).rejects.toThrow("Expected 1 to 100");
    await expect(record(ownerA, orgA, Array.from({ length: 101 }, () => ({ publication_id: posts[3], outcome: "alive" })))).rejects.toThrow("Expected 1 to 100");
  });
});

describe("authorization", () => {
  it("blocks other organizations, customers and the anonymous role from writing", async () => {
    await expect(record(ownerB, orgA, [{ publication_id: posts[3], outcome: "alive" }])).rejects.toThrow("Not authorized");
    await expect(record(client, orgA, [{ publication_id: posts[3], outcome: "alive" }])).rejects.toThrow("Not authorized");
    await expect(record(ownerA, orgA, [{ publication_id: postB, outcome: "alive" }])).rejects.toThrow("Post not found");
    await db.exec("set role anon");
    try { await expect(db.query("select public.reporting_record_checks($1,'[]')", [orgA])).rejects.toThrow(); } finally { await db.exec("reset role"); }
  });

  it("allows no direct writes to checks, notifications or state", async () => {
    await expect(asUser(ownerA, () => db.query("insert into public.reporting_post_checks(organization_id,publication_id,outcome,tone,message) values ($1,$2,'alive','positive','x')", [orgA, posts[0]]))).rejects.toThrow();
    await expect(asUser(ownerA, () => db.query("update public.reporting_post_checks set outcome='alive'"))).rejects.toThrow();
    await expect(asUser(ownerA, () => db.query("delete from public.reporting_notifications"))).rejects.toThrow();
    await expect(asUser(ownerA, () => db.query("insert into public.reporting_notifications(organization_id,kind,tone,title,message) values ($1,'check_batch','positive','x','x')", [orgA]))).rejects.toThrow();
    await expect(asUser(ownerA, () => db.query("insert into public.reporting_notification_state(organization_id,user_id) values ($1,$2)", [orgA, ownerA]))).rejects.toThrow();
    await expect(asUser(ownerA, () => db.query("select public.reporting_record_observation($1,'live')", [posts[0]]))).resolves.toBeTruthy();
  });

  it("keeps organizations apart", async () => {
    expect((await asUser(ownerB, () => db.query("select id from public.reporting_post_checks"))).rows).toEqual([]);
    expect((await asUser(ownerB, () => db.query("select id from public.reporting_notifications where organization_id=$1", [orgA]))).rows).toEqual([]);
  });

  it("shows customer users only checks and single-post notifications for their assigned customer", async () => {
    const checks = await asUser(client, () => db.query<{ publication_id: string }>("select distinct publication_id from public.reporting_post_checks"));
    expect(checks.rows.map((row) => row.publication_id).every((id) => posts.includes(id))).toBe(true);
    const notes = await asUser(client, () => db.query<{ kind: string }>("select kind from public.reporting_notifications"));
    expect(notes.rows.length).toBeGreaterThan(0);
    expect(notes.rows.every((row) => row.kind === "check_result")).toBe(true);
    expect((await asUser(otherClient, () => db.query("select id from public.reporting_post_checks"))).rows).toEqual([]);
    expect((await asUser(otherClient, () => db.query("select id from public.reporting_notifications"))).rows).toEqual([]);
    await record(ownerA, orgA, [{ publication_id: post2, outcome: "alive" }]);
    expect((await asUser(client, () => db.query("select id from public.reporting_post_checks where publication_id=$1", [post2]))).rows).toEqual([]);
  });

  it("lets staff see the batch summaries", async () => {
    const kinds = await asUser(ownerA, () => db.query<{ kind: string }>("select distinct kind from public.reporting_notifications"));
    expect(kinds.rows.map((row) => row.kind).sort()).toEqual(["check_batch", "check_result"]);
  });
});

describe("notification read state", () => {
  it("lets a member mark notifications seen and read only their own state", async () => {
    await asUser(ownerA, () => db.query("select public.reporting_mark_notifications_seen($1)", [orgA]));
    await asUser(client, () => db.query("select public.reporting_mark_notifications_seen($1)", [orgA]));
    expect((await asUser(ownerA, () => db.query<{ user_id: string }>("select user_id from public.reporting_notification_state"))).rows).toEqual([{ user_id: ownerA }]);
    await asUser(ownerA, () => db.query("select public.reporting_mark_notifications_seen($1)", [orgA]));
    expect(await scalar("select count(*) from public.reporting_notification_state where user_id=$1", [ownerA])).toBe("1");
  });
  it("refuses someone outside the organization", async () => {
    await expect(asUser(ownerB, () => db.query("select public.reporting_mark_notifications_seen($1)", [orgA]))).rejects.toThrow("Not authorized");
  });
});

describe("needsCheck", () => {
  it("queues unchecked, stale and attention outcomes, but not fresh good results", () => {
    expect(needsCheck({ visibility: "not_checked" }, false)).toBe(true);
    expect(needsCheck({ visibility: "live", last_check_outcome: "alive" }, true)).toBe(true);
    expect(needsCheck({ visibility: "live", last_check_outcome: "proxy_issue" }, false)).toBe(true);
    expect(needsCheck({ visibility: "live", last_check_outcome: "alive" }, false)).toBe(false);
    expect(needsCheck({ visibility: "confirmed_removed", last_check_outcome: "deleted_from_nd" }, false)).toBe(false);
  });
});
