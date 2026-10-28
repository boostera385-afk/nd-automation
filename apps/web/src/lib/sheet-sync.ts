import "server-only";
import { parseSyncEndpoint, sheetResponseSchema, type SheetRow, type SheetTab } from "./sheet-status";
import { masterResponseSchema, type MasterTab } from "./workflow";
import { requireWorkspace } from "./data";
import { z } from "zod";

export type SheetSyncErrorCode = "not_configured" | "unreachable" | "unauthorized" | "bad_response" | "sheet_unavailable" | "sheet_not_found";

export class SheetSyncError extends Error {
  constructor(readonly code: SheetSyncErrorCode, message: string) { super(message); }
}

const MAX_BODY_CHARS = 3_000_000;
const TIMEOUT_MS = 25_000;

function settings() {
  const endpoint = parseSyncEndpoint(process.env.SHEET_SYNC_URL);
  const token = process.env.SHEET_SYNC_TOKEN?.trim() ?? "";
  const organization = z.uuid().safeParse(process.env.SHEET_SYNC_ORGANIZATION_ID);
  return endpoint && token.length >= 24 && organization.success ? { endpoint, token, organizationId: organization.data } : null;
}

export function sheetSyncConfigured(organizationId: string): boolean {
  return settings()?.organizationId === organizationId;
}

// The token and endpoint stay on the server. Messages are written for the user and never echo either value.
export async function fetchSheetRows(sheet: SheetTab): Promise<{ rows: SheetRow[]; fetchedAt: string; truncated: boolean }> {
  return fetchRows(sheet, "getPostRecords");
}

export async function fetchMasterRows(sheet: MasterTab): Promise<{ rows: SheetRow[]; fetchedAt: string; truncated: boolean }> {
  return fetchRows(sheet, "getTaskRows");
}

async function fetchRows(sheet: MasterTab, action: "getTaskRows" | "getPostRecords"): Promise<{ rows: SheetRow[]; fetchedAt: string; truncated: boolean }> {
  const { organization } = await requireWorkspace(true);
  const config = settings();
  if (!config || config.organizationId !== organization.id) throw new SheetSyncError("not_configured", "The Sheet connection is not configured for this workspace. Ask your administrator to finish one-time setup.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let text: string;
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, sheet, token: config.token }),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new SheetSyncError("unreachable", "The sheet connection did not respond. Try again in a moment.");
    text = await response.text();
  } catch (error) {
    if (error instanceof SheetSyncError) throw error;
    throw new SheetSyncError("unreachable", "Could not reach the sheet connection. Check the network and try again.");
  } finally {
    clearTimeout(timer);
  }

  const bad = () => new SheetSyncError("bad_response", "The sheet connection returned an unexpected response. Check that the deployment is a Web app open to “Anyone”.");
  if (text.length > MAX_BODY_CHARS) throw bad();
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw bad(); }
  const parsed = (action === "getTaskRows" ? masterResponseSchema : sheetResponseSchema).safeParse(json);
  if (!parsed.success) throw bad();

  if (!parsed.data.ok) {
    const code = parsed.data.error;
    if (code === "unauthorized") throw new SheetSyncError("unauthorized", "The sheet connection rejected the secret token. Check that both sides use the same value.");
    if (code === "invalid_action") throw new SheetSyncError("sheet_unavailable", "Update the separate dashboard connector to enable master-tab previews. The desktop and Fudge scripts should not be replaced.");
    if (code === "sheet_not_found") throw new SheetSyncError("sheet_not_found", "That tab does not exist in the connected Sheet. Nothing was changed.");
    if (["status_column_missing", "profile_column_missing", "invalid_sheet"].includes(code)) throw new SheetSyncError("sheet_unavailable", "That tab's Profile Name / Status headers or connector configuration need checking. Nothing was changed.");
    throw bad();
  }
  if (parsed.data.sheet !== sheet) throw bad();
  return { rows: parsed.data.rows, fetchedAt: parsed.data.fetchedAt, truncated: parsed.data.truncated };
}
