import { z } from "zod";
import { parseSyncEndpoint } from "./sheet-status";

export function extractSpreadsheetId(input: string): string | null {
  const value = input.trim();
  if (z.uuid().safeParse(value).success) return null;
  if (/^[A-Za-z0-9_-]{20,200}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port || url.username || url.password) return null;
    return /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:\/(?:edit|view|preview))?\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}

export function validSetupToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{24,256}$/.test(token);
}

export function generateSetupToken(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Names the exact inputs still missing, so the page never shows a vague "complete the fields" notice. */
export function sheetSetupGaps(endpoint: string, token: string): string[] {
  const gaps: string[] = [];
  if (!parseSyncEndpoint(endpoint)) gaps.push("the connector Web app URL ending in /exec (step 4)");
  if (!validSetupToken(token)) gaps.push("the 24–256 character SYNC_TOKEN value (step 3)");
  return gaps;
}

/**
 * Always shows the complete three-line block. Missing or invalid inputs become visible
 * placeholders, and a token is only ever embedded once it passes validation, so this can
 * never render a partial or malformed credential.
 */
export function sheetEnvironmentTemplate(endpoint: string, token: string, workspaceId: string): string {
  const url = parseSyncEndpoint(endpoint);
  return [
    `SHEET_SYNC_URL=${url ? url.href : "<paste the /exec Web app URL from step 4>"}`,
    `SHEET_SYNC_TOKEN=${validSetupToken(token) ? token : "<paste the SYNC_TOKEN value from step 3>"}`,
    `SHEET_SYNC_ORGANIZATION_ID=${workspaceId}`,
  ].join("\n");
}

export function sheetEnvironmentSnippet(endpoint: string, token: string, workspaceId: string): string | null {
  const url = parseSyncEndpoint(endpoint);
  if (!url || /YOUR_|XXXXXXXX/.test(url.pathname) || !validSetupToken(token) || !z.uuid().safeParse(workspaceId).success) return null;
  // The wizard never permits tokens or other data in a URL query or multiline env values.
  try { const original = new URL(endpoint.trim()); if (original.search || original.hash) return null; } catch { return null; }
  return `SHEET_SYNC_URL=${url.href}\nSHEET_SYNC_TOKEN=${token}\nSHEET_SYNC_ORGANIZATION_ID=${workspaceId}`;
}
