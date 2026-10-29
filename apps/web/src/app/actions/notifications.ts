"use server";

import { requireWorkspace } from "@/lib/data";

// Marks the bell as read for this person only. Failure is harmless: the badge simply reappears on the next refresh.
export async function markNotificationsSeen(expectedWorkspace: string): Promise<{ ok: boolean }> {
  const { db, organization } = await requireWorkspace(false, expectedWorkspace ?? "");
  const { error } = await db.rpc("reporting_mark_notifications_seen", { org: organization.id });
  return { ok: !error };
}
