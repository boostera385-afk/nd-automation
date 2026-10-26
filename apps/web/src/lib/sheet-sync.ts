import "server-only";
import { parseSyncEndpoint, sheetResponseSchema, type SheetRow, type SheetTab } from "./sheet-status";

export type SheetSyncErrorCode = "not_configured" | "unreachable" | "unauthorized" | "bad_response" | "sheet_unavailable";

export class SheetSyncError extends Error {
  constructor(readonly code: SheetSyncErrorCode, message: string) { super(message); }
}

const MAX_BODY_CHARS = 3_000_000;
const TIMEOUT_MS = 25_000;

function settings() {
  const endpoint = parseSyncEndpoint(process.env.SHEET_SYNC_URL);
  const token = process.env.SHEET_SYNC_TOKEN?.trim() ?? "";
  return endpoint && token.length >= 24 ? { endpoint, token } : null;
}

export function sheetSyncConfigured(): boolean {
  return settings() !== null;
}

// The token and endpoint stay on the server. Messages are written for the user and never echo either value.
export async function fetchSheetRows(sheet: SheetTab): Promise<{ rows: SheetRow[]; fetchedAt: string; truncated: boolean }> {
  const config = settings();
  if (!config) throw new SheetSyncError("not_configured", "The sheet connection is not set up yet.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let text: string;
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "getPostRecords", sheet, token: config.token }),
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
  const parsed = sheetResponseSchema.safeParse(json);
  if (!parsed.success) throw bad();

  if (!parsed.data.ok) {
    const code = parsed.data.error;
    if (code === "unauthorized") throw new SheetSyncError("unauthorized", "The sheet connection rejected the secret token. Check that both sides use the same value.");
    if (code === "sheet_not_found" || code === "status_column_missing" || code === "invalid_sheet") throw new SheetSyncError("sheet_unavailable", "That tab was not found, or it has no Status column.");
    throw bad();
  }
  return { rows: parsed.data.rows, fetchedAt: parsed.data.fetchedAt, truncated: parsed.data.truncated };
}
