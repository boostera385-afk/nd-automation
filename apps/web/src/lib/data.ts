import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { publicConfig } from "./env";
import type { Comment, Customer, Membership, Observation, Organization, Publication, WorkSession } from "./types";

export const getContext = cache(async () => {
  if (!publicConfig()) redirect("/login");
  const db = await createClient();
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) redirect("/login");
  const { data, error } = await db.from("reporting_memberships").select("organization_id,role").eq("user_id", auth.user.id).limit(1).maybeSingle();
  if (error) throw new Error("Database setup is incomplete or unavailable. Apply the reporting migration and check Supabase connectivity.");
  const membership = data as Membership | null;
  let organization: Organization | null = null;
  if (membership) {
    const result = await db.from("reporting_organizations").select("id,name,time_zone").eq("id", membership.organization_id).single();
    if (result.error) throw new Error("Your workspace could not be loaded.");
    organization = result.data as Organization;
  }
  return { db, user: auth.user, membership, organization, isStaff: membership !== null && membership.role !== "customer" };
});

export async function requireWorkspace(staffOnly = false) {
  const context = await getContext();
  if (!context.organization || !context.membership) redirect("/dashboard");
  if (staffOnly && !context.isStaff) throw new Error("Your role cannot change reporting records.");
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
