import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { sheetResponseSchema } from "@/lib/sheet-status";
import { MASTER_TABS, masterResponseSchema } from "@/lib/workflow";

const source = readFileSync(fileURLToPath(new URL("../../../integrations/sheets/reporting-sync.gs", import.meta.url)), "utf8");
const TOKEN = "t".repeat(32);

// Same column layout as the real "Auto Posting" tab, including the credential columns.
const headers = ["Profile Name", "Email", "Password", "Post Text", "Visibility", "Pictures", "Random Post Text", "Area", "Spammers", "Proxy", "Post link", "Status"];
const SECRET_VALUES = ["leak-me@example.com", "hunter2-password", "user:proxypass@1.2.3.4:8080"];
const dataRows = [
  ["Alice Profile", SECRET_VALUES[0], SECRET_VALUES[1], "First line of the post\nsecond line that must not be sent", "Anyone", "", "", "", "", SECRET_VALUES[2], "https://nextdoor.com/p/abc123", "Posted"],
  ["Bob Profile", SECRET_VALUES[0], SECRET_VALUES[1], "Another post " + "x".repeat(300), "Anyone", "", "", "", "", SECRET_VALUES[2], "", "Failed: Locator.click: Timeout 30000ms exceeded."],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
];

function run(opts: { props?: Record<string, string>; body?: unknown; sheets?: Record<string, string[][]> } = {}) {
  const rangeReads: { row: number; col: number }[] = [];
  const grid = (name: string) => (opts.sheets?.[name] ?? [headers, ...dataRows]);
  const makeSheet = (name: string) => {
    const cells = grid(name);
    return {
      getName: () => name,
      getLastRow: () => cells.length,
      getLastColumn: () => cells[0].length,
      getRange: (row: number, col: number, nRows: number, nCols: number) => {
        rangeReads.push({ row, col });
        const block = Array.from({ length: nRows }, (_, r) => Array.from({ length: nCols }, (_, c) => cells[row - 1 + r][col - 1 + c]));
        return { getValues: () => block, getDisplayValues: () => block };
      },
    };
  };
  const names = Object.keys(opts.sheets ?? { "Auto Posting": [] });
  const spreadsheet = { getSheetByName: (n: string) => (names.includes(n) ? makeSheet(n) : null), getSheets: () => names.map(makeSheet) };
  const props = opts.props ?? { SYNC_TOKEN: TOKEN, SHEET_ID: "sheet-id" };
  const sandbox: Record<string, unknown> = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => props[key] ?? null }) },
    SpreadsheetApp: { openById: () => spreadsheet },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const post = (body: unknown) => JSON.parse((sandbox.doPost as (e: unknown) => { text: string })({ postData: { contents: JSON.stringify(body) } }).text) as Record<string, unknown>;
  return { post, rangeReads, doGet: () => JSON.parse((sandbox.doGet as () => { text: string })().text) as Record<string, unknown>, body: opts.body };
}

describe("reporting-sync.gs", () => {
  it.each(MASTER_TABS)("previews safe metadata for %s without reading credential columns", (sheet) => {
    const title = sheet === "Auto Posting" ? "Post Text" : "Title";
    const taskHeaders = ["Profile Name", "Email", "Password", "Cookies", "Proxy", title, "Post link", "Status"];
    const { post, rangeReads } = run({ sheets: { [sheet]: [taskHeaders, ["Exact profile", ...SECRET_VALUES, "private-proxy", "Safe short title", "https://nextdoor.com/p/task", ""]] } });
    const result = post({ action: "getTaskRows", token: TOKEN, sheet });
    expect(masterResponseSchema.safeParse(result).success).toBe(true);
    const columns = rangeReads.filter((read) => read.row > 1).map((read) => taskHeaders[read.col - 1]);
    expect(columns).not.toContain("Email"); expect(columns).not.toContain("Password"); expect(columns).not.toContain("Cookies"); expect(columns).not.toContain("Proxy");
    for (const secret of SECRET_VALUES) expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("supports the legacy cookie tab alias without renaming or writing it", () => {
    const result = run({ sheets: { "Bulk proxy import": [["Profile Name", "Cookies", "Status"], ["Known profile", "private-cookie", "Imported"]] } }).post({ action: "getTaskRows", token: TOKEN, sheet: "Bulk cookies import" });
    expect(result).toMatchObject({ ok: true, sheet: "Bulk cookies import" });
    expect(JSON.stringify(result)).not.toContain("private-cookie");
  });
  it("excludes unheaded account-side data and refuses missing Profile Name headers", () => {
    const result = run({ sheets: { "ND Acc Creation": [["Profile Name", "Password", "Status", ""], ["", "", "", "unmapped-private-material"]] } }).post({ action: "getTaskRows", token: TOKEN, sheet: "ND Acc Creation" });
    expect(result).toMatchObject({ ok: true, rows: [] });
    const missing = run({ sheets: { "ND Acc Creation": [["Password", "Status"], ["private", ""]] } });
    expect(missing.post({ action: "getTaskRows", token: TOKEN, sheet: "ND Acc Creation" })).toEqual({ ok: false, error: "profile_column_missing" });
    expect(missing.rangeReads.every((read) => read.row === 1)).toBe(true);
  });
  it("refuses master previews with invalid tabs or without a valid token", () => {
    const { post, rangeReads } = run();
    expect(post({ action: "getTaskRows", sheet: "Auto Posting", token: "bad" })).toMatchObject({ ok: false, error: "unauthorized" });
    for (const sheet of ["__proto__", "constructor", "Private", "toString"]) expect(post({ action: "getTaskRows", token: TOKEN, sheet })).toMatchObject({ ok: false, error: "invalid_sheet" });
    expect(rangeReads).toHaveLength(0);
  });
  it("refuses a wrong or missing token without touching the sheet", () => {
    const { post, rangeReads } = run();
    expect(post({ action: "getPostRecords", token: "wrong" })).toEqual({ ok: false, error: "unauthorized" });
    expect(post({ action: "getPostRecords" })).toEqual({ ok: false, error: "unauthorized" });
    expect(rangeReads).toHaveLength(0);
  });

  it("refuses everything when the secret is missing or weak", () => {
    expect(run({ props: { SHEET_ID: "x" } }).post({ action: "getPostRecords", token: TOKEN })).toEqual({ ok: false, error: "not_configured" });
    expect(run({ props: { SYNC_TOKEN: "short", SHEET_ID: "x" } }).post({ action: "getPostRecords", token: "short" })).toEqual({ ok: false, error: "not_configured" });
  });

  it("answers GET without data", () => {
    expect(run().doGet()).toEqual({ ok: false, error: "post_only" });
  });

  it("reads ONLY Profile Name, Post Text, Post link and Status cells — never Email, Password or Proxy", () => {
    const { post, rangeReads } = run();
    const result = post({ action: "getPostRecords", token: TOKEN, sheet: "Auto Posting" });
    expect(result.ok).toBe(true);
    const dataColumns = new Set(rangeReads.filter((read) => read.row > 1).map((read) => headers[read.col - 1]));
    expect([...dataColumns].sort()).toEqual(["Post Text", "Post link", "Profile Name", "Status"]);
    const text = JSON.stringify(result);
    for (const secret of SECRET_VALUES) expect(text).not.toContain(secret);
  });

  it("returns a response the dashboard's strict validator accepts, with a one-line truncated title", () => {
    const result = run().post({ action: "getPostRecords", token: TOKEN, sheet: "Auto Posting" });
    const parsed = sheetResponseSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    expect(parsed.data.rows).toHaveLength(2);
    expect(parsed.data.rows[0]).toEqual({ rowNumber: 2, profileName: "Alice Profile", title: "First line of the post", postLink: "https://nextdoor.com/p/abc123", status: "Posted" });
    expect(parsed.data.rows[1].title.length).toBeLessThanOrEqual(120);
    expect(parsed.data.rows[1].status).toContain("Failed");
  });

  it("only serves the two allowed tabs, so a credentials tab can never be requested", () => {
    const { post, rangeReads } = run({ sheets: { "ND Acc Creation": [["Profile Name", "Password", "Status"], ["a", "pw", ""]] } });
    for (const sheet of ["ND Acc Creation", "Incog Profile Creation", "__proto__", "constructor", "toString"]) {
      expect(post({ action: "getPostRecords", token: TOKEN, sheet })).toEqual({ ok: false, error: "invalid_sheet" });
    }
    expect(rangeReads).toHaveLength(0);
  });

  it("rejects unknown actions, including the legacy write actions", () => {
    const { post } = run();
    for (const action of ["updateStatus", "updateRowStatus", "updateColumnValue", "claimRow", "getPendingRows"]) {
      expect(post({ action, token: TOKEN, sheet: "Auto Posting" })).toEqual({ ok: false, error: "invalid_action" });
    }
  });

  it("reports a missing Status column without reading data", () => {
    const { post, rangeReads } = run({ sheets: { "Auto Posting": [["Profile Name", "Post link"], ["a", "b"]] } });
    expect(post({ action: "getPostRecords", token: TOKEN, sheet: "Auto Posting" })).toEqual({ ok: false, error: "status_column_missing" });
    expect(rangeReads.every((read) => read.row === 1)).toBe(true);
  });

  it("contains no write calls", () => {
    expect(source).not.toMatch(/\.(setValue|setValues|appendRow|insertSheet|deleteRow|clear|setName)\(/);
  });
});
