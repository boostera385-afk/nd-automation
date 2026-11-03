import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

// Membership management works exactly like the hosted database: staff add a
// person by the verified email they signed up with, roles change owner-only,
// and nobody is removed while work is still in progress under their session.
const db = new PGlite();
const mail = (name: string) => `${name}@team.test`;
const p: Record<string, string> = {};
let org: string, otherOrg: string;

async function scalar(sql: string, params: unknown[] = []) {
  return Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0])[0];
}
async function as<T>(uid: string, run: () => Promise<T>) {
  await db.exec(`savepoint member_auth; set role authenticated; set request.jwt.claim.sub='${uid}'`);
  try {
    const result = await run();
    await db.exec("reset role; reset request.jwt.claim.sub; release savepoint member_auth");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint member_auth; release savepoint member_auth");
    throw error;
  }
}
const add = (actor: string, address: string, role: string, workspace = org) =>
  as(actor, () => scalar("select public.reporting_add_workspace_member($1,$2,$3)", [workspace, address, role]));
const roster = (actor: string, workspace = org) =>
  as(actor, () => db.query<{ member: string; email: string; member_role: string }>("select member,email,member_role from public.reporting_list_workspace_members($1) order by member_role,email", [workspace]));
const setRole = (actor: string, member: string, role: string, workspace = org) =>
  as(actor, () => scalar("select public.reporting_set_member_role($1,$2,$3)", [workspace, member, role]));
const remove = (actor: string, member: string, workspace = org) =>
  as(actor, () => scalar("select public.reporting_remove_workspace_member($1,$2)", [workspace, member]));
const startSession = (actor: string) => as(actor, () => scalar("select public.reporting_session_action($1,'start','UTC')", [org]));
const endSession = (actor: string) => as(actor, () => scalar("select public.reporting_session_action($1,'end','UTC')", [org]));
const memberCount = async () => Number(await scalar("select count(*) from public.reporting_memberships where organization_id=$1", [org]));
const roleOf = async (member: string) => String(await scalar("select role from public.reporting_memberships where organization_id=$1 and user_id=$2", [org, member]));

beforeAll(async () => {
  for (const name of ["boss", "admin", "oper", "viewer", "peer", "busy", "newbie", "spare1", "spare2", "outsider", "stranger"]) p[name] = randomUUID();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;`);
  for (const name of ["boss", "admin", "oper", "viewer", "peer", "busy", "newbie", "spare1", "spare2", "outsider"]) await db.query("insert into auth.users values ($1,$2,now())", [p[name], mail(name)]);
  await db.query("insert into auth.users values ($1,$2,null)", [p.stranger, mail("stranger")]);
  for (const name of ["202610260001_reporting_foundation.sql", "202610270001_post_checks_and_notifications.sql", "202610270002_monitoring_worker_bridge.sql", "202610270003_worker_bridge_indexes.sql", "202610270004_content_drafts.sql", "202610270005_profile_inventory.sql", "202610270006_publish_jobs.sql", "20261031093000_automation_tasks_v1.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  // Verified helpers are tested independently in verified-access.test.ts; use
  // the same final helper definitions without unrelated policy-table alters.
  const verified = await readFile(new URL("../../../supabase/migrations/20261030155515_verified_access_v1.sql", import.meta.url), "utf8");
  await db.exec(verified.slice(0, verified.indexOf("alter policy membership_read_own")));
  await db.exec(await readFile(new URL("../../../supabase/proposals/workspace_members.sql", import.meta.url), "utf8"));
  await db.exec("begin");
  // A second workspace owned by someone else proves the RPCs cannot leave one org.
  otherOrg = String(await as(p.outsider, () => scalar("select public.reporting_create_workspace('Other workspace')")));
  org = String(await as(p.boss, () => scalar("select public.reporting_create_workspace('Member workspace')")));
  await add(p.boss, mail("admin"), "admin");
  await add(p.boss, mail("oper"), "operator");
  await add(p.admin, mail("viewer"), "customer");
  await add(p.boss, mail("peer"), "owner");
  await add(p.boss, mail("busy"), "operator");
  await db.exec("commit");
}, 120000);
beforeEach(() => db.exec("begin"));
afterEach(() => db.exec("reset role; rollback"));
afterAll(() => db.close());

it("adds verified teammates by email, lists them for staff and grants immediate data access", async () => {
  const added = String(await add(p.boss, mail("newbie"), "operator"));
  expect(await roleOf(added)).toBe("operator");
  // Email lookup tolerates case, like the lowercased addresses Supabase stores.
  expect(String(await add(p.boss, "SPARE1@TEAM.TEST", "customer"))).toBe(p.spare1);
  const listed = (await roster(p.boss)).rows;
  expect(listed.map((row) => [row.email, row.member_role])).toEqual(expect.arrayContaining([
    [mail("boss"), "owner"], [mail("peer"), "owner"], [mail("admin"), "admin"],
    [mail("oper"), "operator"], [mail("busy"), "operator"], [mail("newbie"), "operator"],
    [mail("spare1"), "customer"], [mail("viewer"), "customer"],
  ]));
  const customer = String(await scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Fixture customer') returning id", [org]));
  await scalar("insert into public.reporting_publications(organization_id,customer_id,title,url,account_label,source) values ($1,$2,'Fixture post','https://nextdoor.com/p/fixture','Fixture','manual_entry') returning id", [org, customer]);
  // A newly added staff member reads existing business data through RLS immediately.
  expect(Number(await as(p.newbie, () => scalar("select count(*) from public.reporting_publications where organization_id=$1", [org])))).toBe(1);
  await expect(roster(p.viewer)).rejects.toThrow("Not authorized");
});

it("keeps execute denied from anon and direct table writes impossible", async () => {
  for (const signature of ["reporting_list_workspace_members(uuid)", "reporting_add_workspace_member(uuid,text,text)",
    "reporting_set_member_role(uuid,uuid,text)", "reporting_remove_workspace_member(uuid,uuid)"]) {
    expect(await scalar(`select has_function_privilege('anon','public.${signature}','execute')`)).toBe(false);
    expect(await scalar(`select has_function_privilege('authenticated','public.${signature}','execute')`)).toBe(true);
  }
  expect(await scalar("select has_function_privilege('authenticated','private_reporting.member_has_open_work(uuid,uuid)','execute')")).toBe(false);
  await expect(as(p.boss, () => db.query("insert into public.reporting_memberships values ($1,$2,'operator')", [org, randomUUID()]))).rejects.toThrow("permission denied");
  await expect(as(p.boss, () => db.query("update public.reporting_memberships set role='owner'"))).rejects.toThrow("permission denied");
  await expect(as(p.boss, () => db.query("delete from public.reporting_memberships"))).rejects.toThrow("permission denied");
});

it("enforces caller limits, verified targets, one-workspace-per-person and the 50-member cap", async () => {
  await expect(add(p.oper, mail("spare2"), "operator")).rejects.toThrow("Only an owner or administrator");
  await expect(add(p.viewer, mail("spare2"), "customer")).rejects.toThrow("Not authorized");
  await expect(add(p.admin, mail("spare2"), "admin")).rejects.toThrow("Only an owner can grant");
  // Administrators may still add hands-on teammates themselves.
  expect(String(await add(p.admin, mail("spare2"), "operator"))).toBe(p.spare2);
  await expect(add(p.boss, mail("stranger"), "operator")).rejects.toThrow("No verified account exists");
  await expect(add(p.boss, "nobody@team.test", "operator")).rejects.toThrow("No verified account exists");
  await expect(add(p.boss, mail("oper"), "operator")).rejects.toThrow("already belongs to a workspace");
  await expect(add(p.boss, mail("outsider"), "operator")).rejects.toThrow("already belongs to a workspace");
  await expect(add(p.boss, mail("newbie"), "supervisor")).rejects.toThrow("valid workspace role");
  await expect(add(p.boss, "not-an-email", "operator")).rejects.toThrow("valid email address");
  let fill = await memberCount();
  while (fill < 50) {
    const filler = randomUUID();
    await db.query("insert into auth.users values ($1,$2,now())", [filler, `filler${fill}@team.test`]);
    await db.query("insert into public.reporting_memberships values ($1,$2,'operator')", [org, filler]);
    fill += 1;
  }
  await expect(add(p.boss, mail("newbie"), "operator")).rejects.toThrow("already has 50 members");
});

it("lets only owners change roles, never their own, and gates demotions on open work", async () => {
  await expect(setRole(p.admin, p.busy, "customer")).rejects.toThrow("Only an owner");
  await expect(setRole(p.oper, p.busy, "admin")).rejects.toThrow("Only an owner");
  await expect(setRole(p.boss, p.boss, "customer")).rejects.toThrow("cannot change their own role");
  await expect(setRole(p.boss, p.outsider, "operator")).rejects.toThrow("Member not found");
  await setRole(p.boss, p.busy, "customer");
  expect(await roleOf(p.busy)).toBe("customer");
  // An owner may demote a fellow owner and restore them; another owner remains.
  await setRole(p.peer, p.boss, "admin");
  expect(await roleOf(p.boss)).toBe("admin");
  await setRole(p.peer, p.boss, "owner");
  await setRole(p.boss, p.busy, "customer");
  await setRole(p.boss, p.busy, "operator");
  expect(await roleOf(p.busy)).toBe("operator");
  // A real role change under an open session is refused until it is closed.
  await startSession(p.busy);
  await expect(setRole(p.boss, p.busy, "customer")).rejects.toThrow("work in progress");
  await endSession(p.busy);
  await setRole(p.boss, p.busy, "customer");
  expect(await roleOf(p.busy)).toBe("customer");
});

it("removes only within the caller's rank and cascades customer access", async () => {
  const customer = String(await scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Access fixture') returning id", [org]));
  await db.query("insert into public.reporting_customer_access values ($1,$2,$3)", [org, p.busy, customer]);
  await expect(remove(p.oper, p.busy)).rejects.toThrow("Only an owner or administrator");
  await expect(remove(p.boss, p.boss)).rejects.toThrow("self-removal");
  await expect(remove(p.admin, p.peer)).rejects.toThrow("Administrators can only remove");
  await expect(remove(p.boss, p.outsider)).rejects.toThrow("Member not found");
  await remove(p.admin, p.busy);
  expect(Number(await scalar("select count(*) from public.reporting_memberships where organization_id=$1 and user_id=$2", [org, p.busy]))).toBe(0);
  expect(Number(await scalar("select count(*) from public.reporting_customer_access where user_id=$1", [p.busy]))).toBe(0);
  // A fellow owner without open work can be removed by another owner.
  await remove(p.boss, p.peer);
  expect(Number(await scalar("select count(*) from public.reporting_memberships where user_id=$1 and role='owner'", [p.peer]))).toBe(0);
});

it("blocks removal behind a queued browser task until it is resolved", async () => {
  const worker = String(await scalar("insert into public.reporting_workers(organization_id,name) values ($1,'Guard laptop') returning id", [org]));
  const task = String(await as(p.busy, () => scalar("select public.reporting_enqueue_automation_task($1,$2,'preset_snapshot','Open work guard','{}')", [org, worker])));
  expect(await scalar("select status from public.reporting_automation_tasks where id=$1", [task])).toBe("pending");
  await expect(remove(p.boss, p.busy)).rejects.toThrow("work in progress");
  await as(p.busy, () => scalar("select public.reporting_cancel_automation_task($1,$2)", [org, task]));
  await remove(p.boss, p.busy);
  expect(await memberCount()).toBe(5);
  expect(Number(await scalar("select count(*) from public.reporting_automation_tasks where created_by=$1 and status='pending'", [p.busy]))).toBe(0);
});

it("blocks removal while an open session or a session-owned check exists, then releases", async () => {
  const customer = String(await scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Check customer') returning id", [org]));
  const publication = String(await scalar("insert into public.reporting_publications(organization_id,customer_id,title,url,account_label,source) values ($1,$2,'Guard post','https://nextdoor.com/p/guard','Guard label','manual_entry') returning id", [org, customer]));
  const worker = String(await scalar("insert into public.reporting_workers(organization_id,name) values ($1,'Check laptop') returning id", [org]));
  const profile = randomUUID();
  const binding = String(await scalar("insert into public.reporting_worker_profiles(id,organization_id,worker_id,customer_id,profile_id,account_label) values ($1,$2,$3,$4,$5,$6) returning id",
    [randomUUID(), org, worker, customer, profile, "Guard label"]));
  const session = String(await startSession(p.busy));
  await scalar("insert into public.reporting_check_jobs(organization_id,worker_id,binding_id,publication_id,session_id,profile_id) values ($1,$2,$3,$4,$5,$6) returning id",
    [org, worker, binding, publication, session, profile]);
  // The cancelled job no longer blocks, but the member's open session still does.
  await db.query("update public.reporting_check_jobs set status='cancelled' where session_id=$1 and worker_id=$2", [session, worker]);
  await expect(remove(p.boss, p.busy)).rejects.toThrow("work in progress");
  await endSession(p.busy);
  await remove(p.boss, p.busy);
  expect(Number(await scalar("select count(*) from public.reporting_memberships where organization_id=$1 and user_id=$2", [org, p.busy]))).toBe(0);
});

it("blocks removal behind a session-owned pending publish job", async () => {
  const customer = String(await scalar("insert into public.reporting_customers(organization_id,name) values ($1,'Publish customer') returning id", [org]));
  const worker = String(await scalar("insert into public.reporting_workers(organization_id,name) values ($1,'Publish laptop') returning id", [org]));
  const profile = randomUUID();
  const binding = String(await scalar("insert into public.reporting_worker_profiles(id,organization_id,worker_id,customer_id,profile_id,account_label) values ($1,$2,$3,$4,$5,$6) returning id",
    [randomUUID(), org, worker, customer, profile, "Publish label"]));
  const session = String(await startSession(p.busy));
  const draft = String(await scalar("insert into public.reporting_content_drafts(id,organization_id,binding_id,content,status,approved_at) values ($1,$2,$3,$4,'approved',now()) returning id",
    [randomUUID(), org, binding, JSON.stringify({ kind: "post", title: "Guard draft", body: "Guard body", audience: "anyone", price_cents: null, category: null })]));
  await scalar("insert into public.reporting_publish_jobs(organization_id,binding_id,draft_id,draft_revision,session_id,worker_id,content_snapshot,target_snapshot) values ($1,$2,$3,1,$4,$5,'{}'::jsonb,'{}'::jsonb) returning id",
    [org, binding, draft, session, worker]);
  await expect(remove(p.boss, p.busy)).rejects.toThrow("work in progress");
  await db.query("update public.reporting_publish_jobs set status='cancelled' where session_id=$1", [session]);
  await endSession(p.busy);
  await remove(p.boss, p.busy);
  expect(Number(await scalar("select count(*) from public.reporting_memberships where organization_id=$1 and user_id=$2", [org, p.busy]))).toBe(0);
});

it("keeps every membership RPC inside the caller's own workspace", async () => {
  await expect(roster(p.boss, otherOrg)).rejects.toThrow("Not authorized");
  await expect(add(p.boss, mail("newbie"), "operator", otherOrg)).rejects.toThrow("Not authorized");
  await expect(setRole(p.boss, p.outsider, "admin", otherOrg)).rejects.toThrow("Not authorized");
  await expect(remove(p.boss, p.outsider, otherOrg)).rejects.toThrow("Not authorized");
  // The other owner manages their own workspace normally.
  expect(String(await as(p.outsider, () => scalar("select public.reporting_add_workspace_member($1,$2,$3)", [otherOrg, mail("spare2"), "operator"])))).toBe(p.spare2);
  // A member of our workspace is never reachable from another one.
  await add(p.boss, mail("newbie"), "operator");
  await expect(as(p.outsider, () => scalar("select public.reporting_add_workspace_member($1,$2,$3)", [otherOrg, mail("newbie"), "operator"]))).rejects.toThrow("already belongs");
});
