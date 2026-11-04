"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/data";
import { fetchMasterRows, SheetSyncError } from "@/lib/sheet-sync";
import { extractSpreadsheetId, validSetupToken } from "@/lib/sheet-setup";
import { parseSyncEndpoint } from "@/lib/sheet-status";
import type { FormState } from "./auth";

export type SheetConnectionTestState = { success?: string; error?: string };

// Every page that shows a Sheet connection badge or gate.
const CONNECTION_VIEWS = ["/dashboard", "/dashboard/settings", "/dashboard/settings/sheet-setup", "/dashboard/sheet-sync", "/dashboard/master-sheet", "/dashboard/master-sheet/plan"];

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

/**
 * Step 2 of the 2-step setup: the connector URL and private token save in the
 * workspace (like a worker credential) — no hosting settings or redeploy.
 * Hosted environment values, if an administrator keeps them, still take
 * precedence. Saving reads nothing and starts no jobs; Test connection is the
 * first read. The token never re-renders on any page after this.
 */
export async function saveSheetConnection(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const sheetId = extractSpreadsheetId(String(form.get("sheet_input") ?? ""));
  if (!sheetId) return { error: "Paste your Google Sheet URL (or its spreadsheet ID) in step 1 first, then come back here." };
  const endpoint = parseSyncEndpoint(String(form.get("endpoint_url") ?? ""));
  if (!endpoint) return { error: "Paste the connector Web app URL from Google — it ends in /exec. Nothing was changed." };
  const token = String(form.get("sync_token") ?? "").trim();
  if (!validSetupToken(token)) return { error: "SYNC_TOKEN must be 24–256 letters, numbers, underscores or hyphens — no spaces. Nothing was changed." };
  if (form.get("confirm_save") !== "on") return { error: "Tick the confirmation so the connection is saved for this workspace. Nothing was changed." };
  const { error } = await db.rpc("reporting_save_sheet_sync", { org: organization.id, sheet_id: sheetId, endpoint_url: endpoint.href, sync_token: token });
  if (error) return { error: "The connection could not be saved. Only workspace staff can save it, and the values must match the checked formats. Nothing was changed." };
  for (const path of CONNECTION_VIEWS) revalidatePath(path);
  return { success: "Connection saved for this workspace. Nothing was read or imported — use Test connection below, then open Master Sheet or Import & export." };
}

export async function clearSheetConnection(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  if (form.get("confirm_clear") !== "on") return { error: "Tick the confirmation to remove the saved connection. Nothing was changed." };
  const { error } = await db.rpc("reporting_clear_sheet_sync", { org: organization.id });
  if (error) return { error: "The saved connection could not be removed. Nothing was changed." };
  for (const path of CONNECTION_VIEWS) revalidatePath(path);
  return { success: "Saved connection removed. Your Google connector and Sheet are untouched; hosted environment settings, if any, still apply." };
}
