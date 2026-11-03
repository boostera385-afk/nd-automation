"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import type { FormState } from "./auth";

const refresh = () => revalidatePath("/dashboard", "layout");
const memberRole = z.enum(["owner", "admin", "operator", "customer"]);

// The database raises precise, human-readable errors; map them so the panel
// never shows a raw SQLSTATE, and fail closed with a generic message otherwise.
function memberError(error: unknown): string {
  const message = String((error as { message?: string }).message ?? "");
  if (message.includes("No verified account exists")) return "That email has no confirmed account yet. Ask the teammate to sign up and confirm their email first, then add them again.";
  if (message.includes("already belongs to a workspace")) return "That account already belongs to a workspace. Each account can only ever join one.";
  if (message.includes("Only an owner can grant")) return "Only an owner can grant owner or administrator roles.";
  if (message.includes("Only an owner or administrator")) return "Only an owner or administrator can manage members.";
  if (message.includes("Only an owner can change")) return "Only an owner can change member roles.";
  if (message.includes("50 members")) return "This workspace already has 50 members.";
  if (message.includes("work in progress")) return "The member has work in progress (open session or queued jobs). End the session and finish the queue first.";
  if (message.includes("cannot be demoted") || message.includes("cannot be removed")) return "The last owner cannot be demoted or removed.";
  if (message.includes("cannot change their own role")) return "Owners cannot change their own role.";
  if (message.includes("self-removal")) return "Ask another owner to remove your access; self-removal is not allowed.";
  if (message.includes("Administrators can only remove")) return "Administrators can only remove operators and customer viewers.";
  if (message.includes("Member not found")) return "That member is no longer in this workspace. Refresh the page.";
  if (message.includes("valid email address")) return "Enter a valid email address.";
  if (message.includes("valid workspace role")) return "Choose a valid role.";
  if (message.includes("Not authorized")) return "Your role cannot change reporting records.";
  return "Membership change was not accepted. Refresh the page, verify the email and role, then try again.";
}

export async function addWorkspaceMember(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const address = z.email().max(254).safeParse(form.get("email"));
  const role = memberRole.safeParse(form.get("member_role"));
  if (!address.success || !role.success) return { error: "Enter a teammate email and choose a role." };
  if (form.get("authorized") !== "on") return { error: "Confirm this person works for your business and may see its customer data." };
  const { error } = await db.rpc("reporting_add_workspace_member", { org: organization.id, address: address.data, member_role: role.data });
  if (error) return { error: memberError(error) };
  refresh();
  return { success: `${address.data} added as ${role.data}. They see this business and its data immediately after refreshing their page.` };
}

export async function setMemberWorkspaceRole(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const member = z.uuid().safeParse(form.get("member"));
  const role = memberRole.safeParse(form.get("member_role"));
  if (!member.success || !role.success) return { error: "Choose the member and their new role." };
  const { error } = await db.rpc("reporting_set_member_role", { org: organization.id, member: member.data, member_role: role.data });
  if (error) return { error: memberError(error) };
  refresh();
  return { success: "Role saved. The member keeps their current sign-in; permissions change on their next action." };
}

export async function removeWorkspaceMember(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization, user } = await requireWorkspace(true, form);
  const member = z.uuid().safeParse(form.get("member"));
  if (!member.success) return { error: "Choose the member to remove." };
  if (member.data === user.id) return { error: "Ask another owner to remove your access; self-removal is not allowed." };
  if (form.get("confirmed") !== "on") return { error: "Confirm removing this member's business access." };
  const { error } = await db.rpc("reporting_remove_workspace_member", { org: organization.id, member: member.data });
  if (error) return { error: memberError(error) };
  refresh();
  return { success: "Member removed. Their customer access was removed with it; their past records stay in the business history." };
}
