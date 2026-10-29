import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "./supabase/server";
import { publicConfig } from "./env";
import type { Comment, Customer, Membership, Observation, Organization, Publication, WorkSession } from "./types";
import { MAX_WORKSPACES, WORKSPACE_COOKIE, WORKSPACE_FORM_FIELD, matchesWorkspaceContext, membershipsSchema, selectMembership } from "./workspace-selection";

export const getIdentity = cache(async () => {
  if (!publicConfig()) redirect("/login");
  const db = await createClient();
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) redirect("/login");
  return { db, user: auth.user };
});

export const getWorkspaceAccess = cache(async () => {
  const { db, user } = await getIdentity();
  // Do this before membership, Sheet, reporting or worker reads, including direct
  // Server Action/Route Handler calls. A valid session alone is not verification.
  if (!user.email_confirmed_at) redirect("/verify-email");
  const { data, error } = await db.from("reporting_memberships").select("organization_id,role").eq("user_id", user.id).order("organization_id").limit(MAX_WORKSPACES + 1);
  if (error) throw new Error("Database setup is incomplete or unavailable. Apply the reporting migration and check Supabase connectivity.");
  const parsed = membershipsSchema.safeParse(data);
  if (!parsed.success) throw new Error("Workspace access could not be verified completely. Contact your administrator; no workspace was selected.");
  return { db, user, memberships: parsed.data as Membership[] };
});

export const getContext = cache(async () => {
  const { db, user, memberships } = await getWorkspaceAccess();
  const preference = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const membership = selectMembership(memberships, user.id, preference);
  if (memberships.length && !membership) redirect("/workspaces");
  let organization: Organization | null = null;
  if (membership) {
    const result = await db.from("reporting_organizations").select("id,name,time_zone").eq("id", membership.organization_id).single();
    const parsed = z.strictObject({ id: z.uuid(), name: z.string().min(1).max(100), time_zone: z.string().min(1).max(100) }).safeParse(result.data);
    if (result.error || !parsed.success || parsed.data.id !== membership.organization_id) throw new Error("Your workspace could not be loaded.");
    organization = parsed.data;
  }
  return { db, user, memberships, membership, organization, isStaff: membership !== null && membership.role !== "customer" };
});

export async function requireWorkspace(staffOnly = false, expected?: FormData | string) {
  const context = await getContext();
  if (!context.organization || !context.membership) redirect("/dashboard");
  if (staffOnly && !context.isStaff) throw new Error("Your role cannot change reporting records.");
  if (expected !== undefined) {
    const value = typeof expected === "string" ? expected : expected.getAll(WORKSPACE_FORM_FIELD);
    const scope = Array.isArray(value) && value.length === 1 ? value[0] : value;
    if (!matchesWorkspaceContext(scope, context.user.id, context.organization.id)) {
      redirect("/workspaces?notice=context-changed");
    }
  }
  return { ...context, organization: context.organization, membership: context.membership };
}

export const getDashboardData = cache(async () => {
  const context = await getContext();
  if (!context.organization) return { customers: [] as Customer[], publications: [] as Publication[], comments: [] as Comment[], session: null as WorkSession | null, truncated: false };
  const org = context.organization.id;
  const results = await Promise.all([
    context.db.from("reporting_customers").select("*").eq("organization_id", org).order("name").limit(501),
    context.db.from("reporting_publications").select("*").eq("organization_id", org).order("created_at", { ascending: false }).limit(501),
    context.db.from("reporting_comments").select("*").eq("organization_id", org).order("first_observed_at", { ascending: false }).limit(1001),
    context.db.from("reporting_work_sessions").select("*").eq("organization_id", org).eq("user_id", context.user.id).neq("status", "closed").maybeSingle(),
  ]);
  if (results.some((result) => result.error)) throw new Error("Reporting data could not be loaded. No saved result has been changed.");
  return {
    customers: (results[0].data || []).slice(0, 500) as Customer[],
    publications: (results[1].data || []).slice(0, 500) as Publication[],
    comments: (results[2].data || []).slice(0, 1000) as Comment[],
    session: results[3].data as WorkSession | null,
    truncated: (results[0].data?.length || 0) > 500 || (results[1].data?.length || 0) > 500 || (results[2].data?.length || 0) > 1000,
  };
});

export async function getPublication(id: string) {
  const { db, organization } = await requireWorkspace();
  const publication = await db.from("reporting_publications").select("*").eq("organization_id", organization.id).eq("id", id).maybeSingle();
  if (publication.error) throw new Error("Publication could not be loaded.");
  if (!publication.data) return null;
  const [observations, comments] = await Promise.all([
    db.from("reporting_observations").select("*").eq("organization_id", organization.id).eq("publication_id", id).order("observed_at", { ascending: false }).limit(100),
    db.from("reporting_comments").select("*").eq("organization_id", organization.id).eq("publication_id", id).order("first_observed_at", { ascending: false }).limit(200),
  ]);
  if (observations.error || comments.error) throw new Error("Publication history could not be loaded.");
  return { publication: publication.data as Publication, observations: observations.data as Observation[], comments: comments.data as Comment[] };
}
