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

export function sheetEnvironmentSnippet(endpoint: string, token: string, workspaceId: string): string | null {
  const url = parseSyncEndpoint(endpoint);
  if (!url || /YOUR_|XXXXXXXX/.test(url.pathname) || !validSetupToken(token) || !z.uuid().safeParse(workspaceId).success) return null;
  // The wizard never permits tokens or other data in a URL query or multiline env values.
  try { const original = new URL(endpoint.trim()); if (original.search || original.hash) return null; } catch { return null; }
  return `SHEET_SYNC_URL=${url.href}\nSHEET_SYNC_TOKEN=${token}\nSHEET_SYNC_ORGANIZATION_ID=${workspaceId}`;
}
