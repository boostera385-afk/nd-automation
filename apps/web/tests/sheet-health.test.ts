import { describe, expect, it } from "vitest";
import { buildHealthReport, healthToCsv, MAX_HEALTH_ROWS } from "@/lib/sheet-health";
import type { SheetRow } from "@/lib/sheet-status";

const link = (id: string) => `https://nextdoor.com/p/${id}`;
const row = (rowNumber: number, overrides: Partial<SheetRow> = {}): SheetRow => ({ rowNumber, profileName: `Profile ${rowNumber}`, title: "t", postLink: link(`ID${rowNumber}`), status: "Posted", ...overrides });
const issue = (rows: SheetRow[], code: string) => buildHealthReport(rows).issues.find((item) => item.code === code);

describe("sheet health report", () => {
  it("reports a clean sheet as clean", () => {
    const report = buildHealthReport([row(2), row(3), row(4, { status: "", postLink: "" })]);
    expect(report.issues).toEqual([]);
    expect(report.rowsNeedingAction).toBe(0);
    expect(report.cleanRows).toBe(3);
  });

  it("flags a link with an empty status as a re-post risk (high)", () => {
    const found = issue([row(2, { status: "" })], "reprocess_risk");
    expect(found?.severity).toBe("high");
    expect(found?.rows.map((r) => r.rowNumber)).toEqual([2]);
  });

  it("flags posted rows with no or unusable links (high)", () => {
    const rows = [row(2, { postLink: "" }), row(3, { status: "Posted | Link: No link extracted", postLink: "" }), row(4, { postLink: "https://nextdoor.com/profile/someone" })];
    expect(issue(rows, "posted_no_link")?.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(issue(rows, "posted_bad_link")?.rows[0].rowNumber).toBe(4);
  });

  it("lists every row in a duplicate-link group and points at the others", () => {
    const rows = [row(2, { postLink: link("SAME") }), row(3, { postLink: link("SAME") }), row(4, { postLink: link("SAME") }), row(5)];
    const found = issue(rows, "duplicate_link");
    expect(found?.total).toBe(3);
    expect(found?.rows[0].note).toBe("Link also on row 3, 4");
  });

  it("separates failures, retries, stopped runs and stuck claims", () => {
    const rows = [row(2, { status: "Failed: Locator.click: Timeout", postLink: "" }), row(3, { status: "Failed (Timeout/Retryable): Failed to start profile", postLink: "" }), row(4, { status: "Failed (Stopped)", postLink: "" }), row(5, { status: "CLAIMED", postLink: "" })];
    expect(issue(rows, "failed")?.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(issue(rows, "failed_retryable")?.rows.map((r) => r.rowNumber)).toEqual([3]);
    expect(issue(rows, "claimed")?.rows.map((r) => r.rowNumber)).toEqual([5]);
  });

  it("flags a failed row that still has a link, and rows with no profile name", () => {
    const rows = [row(2, { status: "Failed: x" }), row(3, { profileName: "" })];
    expect(issue(rows, "failed_with_link")?.rows.map((r) => r.rowNumber)).toEqual([2]);
    expect(issue(rows, "missing_profile")?.rows.map((r) => r.rowNumber)).toEqual([3]);
  });

  it("flags unrecognised and non-standard status wording as low severity that does not count as needing action", () => {
    const rows = [row(2, { status: "posted" }), row(3, { status: "Imported 51 cookies", postLink: "" })];
    const report = buildHealthReport(rows);
    expect(report.issues.map((item) => [item.code, item.severity])).toEqual([["unrecognised_status", "low"], ["nonstandard_wording", "low"]]);
    expect(report.rowsNeedingAction).toBe(0);
  });

  it("flags sheet-recorded deletions and proxy issues for follow-up without calling them problems with wording", () => {
    const rows = [row(2, { status: "Post Deleted from ND" }), row(3, { status: "Proxy Issue" }), row(4, { status: "Alive" })];
    const report = buildHealthReport(rows);
    expect(report.issues.map((item) => item.code)).toEqual(["sheet_deleted", "sheet_proxy_issue"]);
    expect(report.rowsNeedingAction).toBe(2);
  });

  it("matches the shape of the real Auto Posting snapshot: 93 rows, 79 posted with links, 9 posted without, 5 failed", () => {
    const rows = [
      ...Array.from({ length: 79 }, (_, i) => row(i + 2)),
      ...Array.from({ length: 8 }, (_, i) => row(i + 81, { postLink: "" })),
      row(89, { status: "Posted | Link: No link extracted", postLink: "" }),
      ...Array.from({ length: 4 }, (_, i) => row(i + 90, { status: "Failed: Locator.click: Timeout 30000ms exceeded.", postLink: "" })),
      row(94, { status: "Failed (Timeout/Retryable): Failed to start profile", postLink: "" }),
    ];
    const report = buildHealthReport(rows);
    expect(report.totalRows).toBe(93);
    expect(issue(rows, "posted_no_link")?.total).toBe(9);
    expect(issue(rows, "failed")?.total).toBe(4);
    expect(issue(rows, "failed_retryable")?.total).toBe(1);
    expect(report.rowsNeedingAction).toBe(14);
    expect(report.cleanRows).toBe(79);
    expect(report.issues.map((item) => item.severity)).toEqual(["high", "medium", "medium"]);
  });

  it("keeps the true total while capping listed rows", () => {
    const rows = Array.from({ length: MAX_HEALTH_ROWS + 50 }, (_, i) => row(i + 2, { postLink: "" }));
    const found = issue(rows, "posted_no_link");
    expect(found?.total).toBe(MAX_HEALTH_ROWS + 50);
    expect(found?.rows).toHaveLength(MAX_HEALTH_ROWS);
  });

  it("builds a CSV handover that neutralises spreadsheet formulas", () => {
    const csv = healthToCsv(buildHealthReport([row(2, { postLink: "", profileName: "=HYPERLINK(\"http://evil\")" })]), "Auto Posting");
    expect(csv.startsWith("\uFEFF\"Sheet tab\"")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).toContain("\"Auto Posting\",\"2\"");
  });
});
