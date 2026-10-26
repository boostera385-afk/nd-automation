import type { SheetRow } from "./sheet-status";

// Runs in the browser. Only four columns are ever kept; every other column, including Email, Password, Proxy and
// Cookies, is discarded here and never uploaded. The server re-validates the result with a strict schema.
export const MAX_UPLOAD_ROWS = 1500;
export const MAX_UPLOAD_BYTES = 5_000_000;

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let touched = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += char;
    } else if (char === '"' && field === "") { quoted = true; touched = true; }
    else if (char === ",") { row.push(field); field = ""; touched = true; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = ""; touched = false;
    } else { field += char; touched = true; }
  }
  if (touched || field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export type TableImport = {
  rows: SheetRow[];
  used: { profile?: string; link?: string; status?: string; title?: string };
  ignoredColumns: string[];
  sensitiveIgnored: string[];
  truncated: boolean;
  error?: string;
};

const aliases = {
  profile: ["profile name", "profile", "account", "account name"],
  link: ["post link", "link", "post url", "url", "share link"],
  status: ["status", "status update"],
  title: ["post text", "title", "post title", "text"],
} as const;

const norm = (header: string) => header.replace(/\s+/g, " ").trim().toLowerCase();
const sensitive = /password|passcode|email|e-mail|proxy|cookie|token|secret|credential|login/i;
const firstLine = (text: string) => text.split(/\r?\n/)[0].replace(/\s+/g, " ").trim();

function findColumn(headers: string[], names: readonly string[]): number {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

const empty = (error: string): TableImport => ({ rows: [], used: {}, ignoredColumns: [], sensitiveIgnored: [], truncated: false, error });

export function rowsFromTable(table: string[][]): TableImport {
  const headerIndex = table.findIndex((row) => row.some((cell) => cell.trim() !== ""));
  if (headerIndex === -1) return empty("The file is empty.");
  const header = table[headerIndex];
  const headers = header.map(norm);
  const columns = { profile: findColumn(headers, aliases.profile), link: findColumn(headers, aliases.link), status: findColumn(headers, aliases.status), title: findColumn(headers, aliases.title) };
  if (columns.status === -1) return empty("Could not find a “Status” column in the first row. Export the tab together with its header row.");
  if (columns.profile === -1 && columns.link === -1) return empty("Could not find a “Profile Name” or “Post link” column in the first row.");

  const kept = new Set(Object.values(columns).filter((index) => index !== -1));
  const ignored = [...new Set(header.map((cell, index) => ({ cell: cell.trim(), index })).filter((item) => item.cell && !kept.has(item.index)).map((item) => item.cell))];
  const used: TableImport["used"] = {};
  for (const [key, index] of Object.entries(columns) as [keyof TableImport["used"], number][]) if (index !== -1) used[key] = header[index].trim();

  const rows: SheetRow[] = [];
  let truncated = false;
  for (let r = headerIndex + 1; r < table.length; r++) {
    const cell = (index: number) => (index === -1 ? "" : (table[r][index] ?? "").trim());
    const profile = cell(columns.profile), link = cell(columns.link), status = cell(columns.status);
    if (!profile && !link && !status) continue;
    if (rows.length >= MAX_UPLOAD_ROWS) { truncated = true; break; }
    rows.push({ rowNumber: r + 1, profileName: profile.slice(0, 120), title: firstLine(cell(columns.title)).slice(0, 120), postLink: link.slice(0, 500), status: status.slice(0, 300) });
  }
  return { rows, used, ignoredColumns: ignored, sensitiveIgnored: ignored.filter((name) => sensitive.test(name)), truncated };
}

export function rowsFromCsv(text: string): TableImport {
  return rowsFromTable(parseCsv(text));
}
