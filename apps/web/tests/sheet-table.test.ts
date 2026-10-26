import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_ROWS, parseCsv, rowsFromCsv, rowsFromTable } from "@/lib/sheet-table";
import { sheetResponseSchema } from "@/lib/sheet-status";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and line breaks, CRLF and a BOM", () => {
    const csv = "\uFEFFa,b,c\r\n1,\"x, y\",\"say \"\"hi\"\"\"\r\n\"line1\nline2\",,end\r\n";
    expect(parseCsv(csv)).toEqual([["a", "b", "c"], ["1", "x, y", "say \"hi\""], ["line1\nline2", "", "end"]]);
  });
  it("keeps blank lines as empty rows and does not invent a trailing row", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([["a", "b"], [""], ["1", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });
  it("accepts a final line without a newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

// The real "Auto Posting" tab layout, including the credential columns.
const header = "Profile Name,Email,Password,Post Text,Visibility,Pictures,Random Post Text,Area,Spammers,Proxy,Post link,Status";
const line = (profile: string, link: string, status: string, text = "First line\nsecond line") => `${profile},leak@example.com,hunter2-secret,"${text}",Anyone,,,,,user:proxypass@1.2.3.4:80,${link},${status}`;

describe("rowsFromCsv", () => {
  it("keeps only the four safe columns and never carries credential values", () => {
    const result = rowsFromCsv([header, line("Alice", "https://nextdoor.com/p/abc123", "Posted")].join("\n"));
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([{ rowNumber: 2, profileName: "Alice", title: "First line", postLink: "https://nextdoor.com/p/abc123", status: "Posted" }]);
    const text = JSON.stringify(result.rows);
    for (const secret of ["leak@example.com", "hunter2-secret", "proxypass"]) expect(text).not.toContain(secret);
    expect(result.sensitiveIgnored.sort()).toEqual(["Email", "Password", "Proxy"]);
    expect(result.ignoredColumns).toContain("Visibility");
    expect(result.used).toMatchObject({ profile: "Profile Name", link: "Post link", status: "Status", title: "Post Text" });
  });

  it("produces rows the dashboard's strict response schema accepts", () => {
    const result = rowsFromCsv([header, line("Alice", "", "Failed: Locator.click: Timeout")].join("\n"));
    const parsed = sheetResponseSchema.safeParse({ ok: true, sheet: "Auto Posting", fetchedAt: "2026-10-27T00:00:00Z", truncated: false, rows: result.rows });
    expect(parsed.success).toBe(true);
  });

  it("numbers rows like the sheet (header is row 1) and skips fully empty rows without shifting numbers", () => {
    const csv = [header, line("A", "https://nextdoor.com/p/a1", "Posted"), ",,,,,,,,,,,", line("B", "https://nextdoor.com/p/b2", "Alive")].join("\n");
    expect(rowsFromCsv(csv).rows.map((row) => row.rowNumber)).toEqual([2, 4]);
  });

  it("accepts the sheet's other names and this dashboard's own export", () => {
    const csv = "Customer,Profile Name,Title,Post link,Status update\nSample,Alice,Spring offer,https://nextdoor.com/p/abc123,Alive\n";
    const result = rowsFromCsv(csv);
    expect(result.rows).toEqual([{ rowNumber: 2, profileName: "Alice", title: "Spring offer", postLink: "https://nextdoor.com/p/abc123", status: "Alive" }]);
    expect(result.ignoredColumns).toEqual(["Customer"]);
  });

  it("works on the Auto Listing layout (Title column)", () => {
    const csv = "Profile Name,Email,Password,Title,Price,Description,Category,Pictures,Chats,Proxy,Post link,Status\nZoe,a@b.c,pw,Old sofa,20,Nice,Furniture,,,p:1,,\n";
    const result = rowsFromCsv(csv);
    expect(result.rows[0]).toMatchObject({ profileName: "Zoe", title: "Old sofa", status: "" });
  });

  it("explains a file it cannot use instead of guessing", () => {
    expect(rowsFromCsv("").error).toMatch(/empty/i);
    expect(rowsFromCsv("Name,Notes\nA,b\n").error).toMatch(/Status/);
    expect(rowsFromCsv("Status,Notes\nPosted,x\n").error).toMatch(/Profile Name/);
  });

  it("limits very large files and says so", () => {
    const body = Array.from({ length: MAX_UPLOAD_ROWS + 5 }, (_, i) => `P${i},x@y.z,pw,t,,,,,,p,https://nextdoor.com/p/id${i}a,Posted`).join("\n");
    const result = rowsFromCsv(`${header}\n${body}`);
    expect(result.rows).toHaveLength(MAX_UPLOAD_ROWS);
    expect(result.truncated).toBe(true);
  });

  it("trims over-long values to what the server accepts", () => {
    const result = rowsFromTable([["Profile Name", "Post link", "Status", "Post Text"], ["x".repeat(500), "https://nextdoor.com/p/" + "a".repeat(900), "Posted".repeat(200), "t".repeat(900)]]);
    const row = result.rows[0];
    expect(row.profileName.length).toBe(120);
    expect(row.postLink.length).toBe(500);
    expect(row.status.length).toBe(300);
    expect(row.title.length).toBe(120);
  });
});
