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
  const rangeReads: { row: number; col: number; rows: number; cols: number }[] = [];
  const grid = (name: string) => (opts.sheets?.[name] ?? [headers, ...dataRows]);
  const makeSheet = (name: string) => {
    const cells = grid(name);
    return {
      getName: () => name,
      getLastRow: () => cells.length,
      getLastColumn: () => Math.max(0, ...cells.map((row) => row.length)),
      getRange: (row: number, col: number, nRows: number, nCols: number) => {
        rangeReads.push({ row, col, rows: nRows, cols: nCols });
        const block = Array.from({ length: nRows }, (_, r) => Array.from({ length: nCols }, (_, c) => cells[row - 1 + r]?.[col - 1 + c] ?? ""));
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

  it("discovers a date-banner workbook layout without returning row content", () => {
    const banner = ["11/4/2026 Wednesday", "", "", "", "", "", "", "", "", "", "", "", "11/4/2026 Wednesday", "", "", "", ""];
    const header = ["Services FUDGE", "Content", "Date Posted ", "Finding Keywords", "Numbers ", "Final Rephrasing", "Post Type", "Pictures", "Areas", "State", "Issues", "Post Status", "Account Name", "Ranking", "", "Remarks", "Fudge Row= 941"];
    const content = "We are very pleased with our new garage door and the whole installation";
    const data = ["Garage Door Repair", content, "", "Garage Door Installation", "(872) 278-7204", content, "Simple post", "1 (61).jpg", "Chicago", "Illinois", "", "", "Bertha Estes", "", "", "private remark", ""];
    const { post, rangeReads } = run({ sheets: { "New Optimize Structure": [banner, header, data] } });

    const result = post({ action: "getMasterLayout", token: TOKEN }) as { ok: boolean; tabCount: number; tabs: { name: string; rows: number; columns: number; headerRow: number; planDate: string | null; unrecognisedHeaders: number; labels: { column: string; label: string }[] }[] };
    expect(result.ok).toBe(true);
    expect(result.tabCount).toBe(1);
    const tab = result.tabs[0];
    expect(tab).toMatchObject({ name: "New Optimize Structure", rows: 3, columns: 17, headerRow: 2, planDate: "2026-11-04", unrecognisedHeaders: 1 });
    expect(tab.labels).toEqual(expect.arrayContaining([
      { column: "A", label: "services" },
      { column: "C", label: "date posted" },
      { column: "J", label: "state" },
      { column: "M", label: "account name" },
    ]));
    const text = JSON.stringify(result);
    expect(text).not.toContain("Bertha Estes");
    expect(text).not.toContain("872");
    expect(text).not.toContain("Garage Door Repair");
    expect(text).not.toContain(content);
    expect(text).not.toContain("Fudge Row");
    // Only the scanned header window is read: rows 1-3, columns 1-17.
    expect(rangeReads).toEqual([{ row: 1, col: 1, rows: 3, cols: 17 }]);
  });

  it("keeps an unrecognised header's text inside the workbook", () => {
    const { post } = run({ sheets: { "Tab One": [["Profile Name", "SuperSecretHeaderValue", "Status"], ["a", "secret-cell", "Posted"]] } });
    const result = post({ action: "getMasterLayout", token: TOKEN });
    expect(result).toMatchObject({ ok: true });
    expect((result as { tabs: { headerRow: number; unrecognisedHeaders: number; labels: unknown[] }[] }).tabs[0]).toMatchObject({ headerRow: 1, unrecognisedHeaders: 1 });
    expect(JSON.stringify(result)).not.toContain("SuperSecretHeaderValue");
    expect(JSON.stringify(result)).not.toContain("secret-cell");
  });

  it("reports a legacy row-1 header layout with no plan date", () => {
    const result = run({ sheets: { "Auto Posting": [headers, ...dataRows] } }).post({ action: "getMasterLayout", token: TOKEN }) as { tabs: { headerRow: number; planDate: string | null; labels: { column: string; label: string }[] }[] };
    expect(result.tabs[0]).toMatchObject({ headerRow: 1, planDate: null });
    expect(result.tabs[0].labels).toEqual(expect.arrayContaining([{ column: "A", label: "profile name" }, { column: "K", label: "post link" }]));
  });

  it("bounds layout discovery and refuses it without the token", () => {
    const many: Record<string, string[][]> = {};
    for (let i = 0; i < 34; i++) many[`Tab ${i}`] = [["Profile Name", "Status"], ["a", "b"]];
    const bounded = run({ sheets: many }).post({ action: "getMasterLayout", token: TOKEN }) as { tabCount: number; truncated: boolean; tabs: unknown[] };
    expect(bounded).toMatchObject({ tabCount: 34, truncated: true });
    expect(bounded.tabs).toHaveLength(30);

    const wide: string[][] = [["Profile Name"], ["a"]];
    wide[0] = Array.from({ length: 60 }, (_, i) => (i === 0 ? "Profile Name" : `Column ${i}`));
    wide[1] = Array.from({ length: 60 }, () => "x");
    const { post, rangeReads } = run({ sheets: { Wide: wide } });
    post({ action: "getMasterLayout", token: TOKEN });
    expect(rangeReads[0]).toMatchObject({ rows: 2, cols: 40 });

    const refused = run();
    expect(refused.post({ action: "getMasterLayout", token: "bad" })).toEqual({ ok: false, error: "unauthorized" });
    expect(refused.post({ action: "getMasterLayout" })).toEqual({ ok: false, error: "unauthorized" });
    expect(refused.rangeReads).toHaveLength(0);
  });

  const ndHeader = ["Services FUDGE", "Content", "Date Posted ", "Finding Keywords", "Numbers ", "Final Rephrasing", "Post Type", "Pictures", "Areas", "State", "Issues", "Post Status", "Account Name", "Ranking", "", "Remarks", "Fudge Row= 941"];
  const ndBanner = (date: string) => [date, "", "", "", "", "", "", "", "", "", "", "", date, "", "", "", ""];
  const ndRow = (link: string, status: string) => ["Garage Door Repair", "Long marketing body text", "", "Garage Door Installation", "(872) 278-7204", "Final post text line\nsecond line", "Simple post", "1 (61).jpg", "Chicago", "Illinois", link, status, "Bertha Estes", "", "", "private remark", ""];
  const ndWorkbook = {
    "New Optimize Structure": [
      ndBanner("11/4/2026 Wednesday"),
      ndHeader,
      ndRow("https://nextdoor.com/p/AbC123?utm_source=sheet", "Posted"),
      ndBanner("11/3/2026 Tuesday"),
      ndHeader,
      ndRow("", ""),
      ndRow("https://nextdoor.com/p/XyZ789", "posted"),
    ],
  };

  it("reads a dated-plan tab as sections using only mapped safe columns", () => {
    const { post, rangeReads } = run({ sheets: ndWorkbook });
    const result = post({ action: "getMasterSections", token: TOKEN, sheet: "New Optimize Structure", linkHeader: "Issues" }) as {
      ok: boolean; action: string; linkColumnSource: string | null; columns: Record<string, string>;
      sections: { planDate: string | null; headerRow: number; fromRow: number; toRow: number; rejectedLinks: number; rows: Record<string, unknown>[] }[];
      warnings: string[]; returnedRows: number;
    };

    expect(result).toMatchObject({ ok: true, action: "getMasterSections", linkColumnSource: "declared", warnings: [], returnedRows: 3, truncated: false });
    expect(result.columns).toEqual({ profile: "M", link: "K", status: "L", title: "F", service: "A", area: "I", state: "J" });
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toMatchObject({ planDate: "2026-11-04", headerRow: 2, fromRow: 3, toRow: 3, rejectedLinks: 0 });
    expect(result.sections[1]).toMatchObject({ planDate: "2026-11-03", headerRow: 5, fromRow: 6, toRow: 7 });
    expect(result.sections[0].rows[0]).toEqual({
      rowNumber: 3,
      profileName: "Bertha Estes",
      postLink: "https://nextdoor.com/p/AbC123",
      status: "Posted",
      title: "Final post text line",
      service: "Garage Door Repair",
      area: "Chicago",
      state: "Illinois",
    });

    const dataColumns = new Set(rangeReads.filter((read) => read.row >= 3).map((read) => read.col));
    for (const excluded of [2, 5, 8, 16]) expect(dataColumns.has(excluded)).toBe(false);
    expect([...dataColumns].sort((a, b) => a - b)).toEqual([1, 6, 9, 10, 11, 12, 13]);
    expect(JSON.stringify(result)).not.toContain("872");
    expect(JSON.stringify(result)).not.toContain("private remark");
    expect(JSON.stringify(result)).not.toContain("Long marketing body text");
  });

  it("never guesses the link column, even when it holds Nextdoor URLs", () => {
    const { post } = run({ sheets: ndWorkbook });
    const result = post({ action: "getMasterSections", token: TOKEN, sheet: "New Optimize Structure" }) as { ok: boolean; columns: Record<string, string>; warnings: string[]; sections: { rows: { postLink: string }[] }[] };
    expect(result.ok).toBe(true);
    expect(result.columns.link).toBeUndefined();
    expect(result.warnings).toEqual(["link_column_missing"]);
    for (const section of result.sections) for (const row of section.rows) expect(row.postLink).toBe("");
  });

  it("reports a declared link header that does not exist instead of falling back", () => {
    const result = run({ sheets: ndWorkbook }).post({ action: "getMasterSections", token: TOKEN, sheet: "New Optimize Structure", linkHeader: "Nextdoor URL" }) as { columns: Record<string, string>; warnings: string[] };
    expect(result.columns.link).toBeUndefined();
    expect(result.warnings).toEqual(["link_column_missing", "link_header_not_found"]);
  });

  it("returns only exact Nextdoor share links and counts the rest", () => {
    const sheets = { Tab: [ndBanner("11/4/2026"), ndHeader, ndRow("https://example.com/p/fake", "Posted"), ndRow("javascript:alert(1)", "Posted"), ndRow("https://nextdoor.com/p/Good123#frag", "Posted")] };
    const result = run({ sheets }).post({ action: "getMasterSections", token: TOKEN, sheet: "Tab", linkHeader: "Issues" }) as { sections: { rows: { postLink: string }[]; rejectedLinks: number }[] };
    expect(result.sections[0].rejectedLinks).toBe(2);
    expect(result.sections[0].rows.map((row) => row.postLink)).toEqual(["", "", "https://nextdoor.com/p/Good123"]);
  });

  it("requires the token and a real tab for section reads", () => {
    const { post, rangeReads } = run({ sheets: ndWorkbook });
    expect(post({ action: "getMasterSections", token: "bad", sheet: "New Optimize Structure" })).toEqual({ ok: false, error: "unauthorized" });
    expect(post({ action: "getMasterSections", token: TOKEN })).toEqual({ ok: false, error: "invalid_sheet" });
    expect(post({ action: "getMasterSections", token: TOKEN, sheet: "Missing" })).toEqual({ ok: false, error: "sheet_not_found" });
    expect(rangeReads).toHaveLength(0);
  });

  it("contains no write calls", () => {
    expect(source).not.toMatch(/\.(setValue|setValues|appendRow|insertSheet|deleteRow|clear|setName)\(/);
  });
});
