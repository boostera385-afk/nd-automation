import "server-only";
import { requireWorkspace } from "./data";
import { isMissingSchemaError } from "./checks";
import type { PostCheck } from "./types";

const columns = "id,publication_id,outcome,tone,message,notes,checked_at,source";

// Both loaders tolerate an unapplied migration: the page still renders and tells staff what to do.
export async function getRecentChecks(limit = 60): Promise<{ available: boolean; checks: PostCheck[] }> {
  const { db, organization } = await requireWorkspace();
  const result = await db.from("reporting_post_checks").select(columns).eq("organization_id", organization.id).order("checked_at", { ascending: false }).limit(limit);
  if (result.error) {
    if (isMissingSchemaError(result.error)) return { available: false, checks: [] };
    throw new Error("Check results could not be loaded.");
  }
  return { available: true, checks: (result.data ?? []) as PostCheck[] };
}

export async function getChecksForPost(publicationId: string): Promise<PostCheck[]> {
  const { db, organization } = await requireWorkspace();
  const result = await db.from("reporting_post_checks").select(columns).eq("organization_id", organization.id).eq("publication_id", publicationId).order("checked_at", { ascending: false }).limit(50);
  if (result.error) {
    if (isMissingSchemaError(result.error)) return [];
    throw new Error("Check history could not be loaded.");
  }
  return (result.data ?? []) as PostCheck[];
}
