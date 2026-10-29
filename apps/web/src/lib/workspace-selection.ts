import { z } from "zod";
import type { Membership } from "./types";

export const WORKSPACE_COOKIE = "nd-workspace";
export const WORKSPACE_FORM_FIELD = "workspaceContext";
export const MAX_WORKSPACES = 100;
export const membershipsSchema = z.array(z.strictObject({
  organization_id: z.uuid(), role: z.enum(["owner", "admin", "operator", "customer"]),
})).max(MAX_WORKSPACES).superRefine((rows, context) => {
  if (new Set(rows.map((row) => row.organization_id)).size !== rows.length) {
    context.addIssue({ code: "custom", message: "Duplicate workspace memberships." });
  }
});

// A cookie is an untrusted preference, never authorization. Scope it to the account
// and recheck the selected ID against current server-read memberships on every request.
export function workspaceContext(userId: string, organizationId: string): string {
  return `${userId}:${organizationId}`;
}

export function selectMembership(memberships: Membership[], userId: string, preference?: string): Membership | null {
  const prefix = `${userId}:`;
  if (preference?.startsWith(prefix)) {
    return memberships.find((row) => workspaceContext(userId, row.organization_id) === preference) ?? null;
  }
  return memberships.length === 1 ? memberships[0] : null;
}

export function matchesWorkspaceContext(expected: unknown, userId: string, organizationId: string): boolean {
  return typeof expected === "string" && expected === workspaceContext(userId, organizationId);
}
