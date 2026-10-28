"use server";

import { requireWorkspace } from "@/lib/data";
import { fetchMasterRows, SheetSyncError } from "@/lib/sheet-sync";

export type SheetConnectionTestState = { success?: string; error?: string };

/** Tests only the saved server configuration; never accepts a caller-supplied URL/token. */
export async function testSavedSheetConnection(): Promise<SheetConnectionTestState> {
  try {
    await requireWorkspace(true);
    const snapshot = await fetchMasterRows("Auto Posting");
    return { success: `Saved connection verified: ${snapshot.rows.length} safe metadata rows returned from Auto Posting${snapshot.truncated ? " (source truncated)" : ""}. No rows imported, Sheet values changed or browser jobs started.` };
  } catch (error) {
    if (error instanceof SheetSyncError) return { error: error.message };
    return { error: "Connection test unavailable. Sign in with staff access and check the saved server configuration. No data was changed." };
  }
}
