import "server-only";
import { parseSyncEndpoint, sheetResponseSchema, type SheetRow, type SheetTab } from "./sheet-status";
import { masterResponseSchema, type MasterTab } from "./workflow";
import { masterLayoutResponseSchema, masterSectionsResponseSchema, type MasterLayout, type MasterSections } from "./master-sections";
import { requireWorkspace } from "./data";
import { z } from "zod";

export type SheetSyncErrorCode = "not_configured" | "unreachable" | "unauthorized" | "bad_response" | "sheet_unavailable" | "sheet_not_found";

export class SheetSyncError extends Error {
  constructor(readonly code: SheetSyncErrorCode, message: string) { super(message); }
}

const MAX_BODY_CHARS = 3_000_000;
const MAX_SECTION_BODY_CHARS = 6_000_000;
const MAX_LAYOUT_BODY_CHARS = 500_000;
const TIMEOUT_MS = 25_000;

function settings() {
  const endpoint = parseSyncEndpoint(process.env.SHEET_SYNC_URL);
  const token = process.env.SHEET_SYNC_TOKEN?.trim() ?? "";
  const organization = z.uuid().safeParse(process.env.SHEET_SYNC_ORGANIZATION_ID);
  const linkHeader = (process.env.SHEET_MASTER_LINK_HEADER ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return endpoint && token.length >= 24 && organization.success ? { endpoint, token, organizationId: organization.data, linkHeader } : null;
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

  const text = await postConnector(config, { action, sheet, token: config.token });

  const bad = () => new SheetSyncError("bad_response", "The sheet connection returned an unexpected response. Check that the deployment is a Web app open to “Anyone”.");
  if (text.length > MAX_BODY_CHARS) throw bad();
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw bad(); }
  const parsed = (action === "getTaskRows" ? masterResponseSchema : sheetResponseSchema).safeParse(json);
  if (!parsed.success) throw bad();

  if (!parsed.data.ok) {
    const code = parsed.data.error;
    if (code === "unauthorized") throw new SheetSyncError("unauthorized", "The sheet connection rejected the secret token. Check that both sides use the same value.");
    if (code === "invalid_action") throw new SheetSyncError("sheet_unavailable", "Update the separate dashboard connector to enable master-tab previews. Your existing Fudge script should not be replaced.");
    if (code === "sheet_not_found") throw new SheetSyncError("sheet_not_found", "That tab does not exist in the connected Sheet. Nothing was changed.");
    if (["status_column_missing", "profile_column_missing", "invalid_sheet"].includes(code)) throw new SheetSyncError("sheet_unavailable", "That tab's Profile Name / Status headers or connector configuration need checking. Nothing was changed.");
    throw bad();
  }
  if (parsed.data.sheet !== sheet) throw bad();
  return { rows: parsed.data.rows, fetchedAt: parsed.data.fetchedAt, truncated: parsed.data.truncated };
}

type ConnectorConfig = NonNullable<ReturnType<typeof settings>>;

async function postConnector(config: ConnectorConfig, body: Record<string, unknown>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new SheetSyncError("unreachable", "The sheet connection did not respond. Try again in a moment.");
    return await response.text();
  } catch (error) {
    if (error instanceof SheetSyncError) throw error;
    throw new SheetSyncError("unreachable", "Could not reach the sheet connection. Check the network and try again.");
  } finally {
    clearTimeout(timer);
  }
}

// Reads a tab's structure only — tab names, sizes, the detected header row and
// recognised labels. No cell text leaves the workbook, so this is safe to call
// before the operator has chosen a tab.
export async function fetchMasterLayout(): Promise<MasterLayout> {
  const { organization } = await requireWorkspace(true);
  const config = requireConnector(settings(), organization.id);

  const text = await postConnector(config, { action: "getMasterLayout", token: config.token });
  const parsed = masterLayoutResponseSchema.safeParse(parseConnectorBody(text, MAX_LAYOUT_BODY_CHARS));
  if (!parsed.success) throw badResponse();
  if (!parsed.data.ok) throw connectorError(parsed.data.error);
  return parsed.data;
}

// Reads a dated-plan tab (banner + repeated headers). Read-only: it returns a
// safe projection and never triggers an import, mapping or browser job.
export async function fetchMasterSections(sheet: string, linkHeader?: string): Promise<MasterSections> {
  const { organization } = await requireWorkspace(true);
  const config = requireConnector(settings(), organization.id);

  const text = await postConnector(config, {
    action: "getMasterSections",
    sheet,
    linkHeader: (linkHeader ?? config.linkHeader).slice(0, 60),
    token: config.token,
  });

  const parsed = masterSectionsResponseSchema.safeParse(parseConnectorBody(text, MAX_SECTION_BODY_CHARS));
  if (!parsed.success) throw badResponse();
  if (!parsed.data.ok) throw connectorError(parsed.data.error);
  if (parsed.data.sheet !== sheet) throw badResponse();
  return parsed.data;
}

function requireConnector(config: ConnectorConfig | null, organizationId: string): ConnectorConfig {
  if (!config || config.organizationId !== organizationId) throw new SheetSyncError("not_configured", "The Sheet connection is not configured for this workspace. Ask your administrator to finish one-time setup.");
  return config;
}

function badResponse(): SheetSyncError {
  return new SheetSyncError("bad_response", "The sheet connection returned an unexpected response. Check that the deployment is a Web app open to “Anyone”.");
}

// The connector answers with a short machine code; the operator-facing sentence
// is written here so a Google error page or a stack trace is never shown.
function connectorError(code: string): SheetSyncError {
  if (code === "unauthorized") return new SheetSyncError("unauthorized", "The sheet connection rejected the secret token. Check that both sides use the same value.");
  if (code === "not_configured") return new SheetSyncError("not_configured", "The connector deployment has no SHEET_ID or SYNC_TOKEN script property yet. Add both in Apps Script → Project Settings → Script properties, then reload this page. Nothing was changed.");
  if (code === "invalid_action") return new SheetSyncError("sheet_unavailable", "The deployed connector is older than this dashboard. Redeploy the current read-only script; do not replace your existing Fudge script.");
  if (code === "sheet_not_found") return new SheetSyncError("sheet_not_found", "That tab does not exist in the connected Sheet. Nothing was changed.");
  if (code === "invalid_sheet") return new SheetSyncError("sheet_unavailable", "Choose a tab that exists in the connected workbook. Nothing was changed.");
  return badResponse();
}

function parseConnectorBody(text: string, maxChars: number): unknown {
  if (text.length > maxChars) throw badResponse();
  try { return JSON.parse(text); } catch { throw badResponse(); }
}
