import { describe, expect, it } from "vitest";
import { exportRows, sheetStatusUpdate, toCsv, EXPORT_HEADERS } from "@/lib/sheet-export";
import { classifyStatus } from "@/lib/sheet-status";
import { rowsFromCsv } from "@/lib/sheet-table";
import type { Publication } from "@/lib/types";
import type { Visibility } from "@/lib/validation";

const labels: Record<Visibility, string> = { not_checked: "Not checked", live: "Observed live", unavailable: "Unavailable", confirmed_removed: "Confirmed removed", deleted_by_owner: "Deleted by owner", unknown: "Unknown" };
const names = new Map([["c1", "Alpha Roofing"], ["c2", "Bright Plumbing"]]);
const now = new Date("2026-10-27T12:00:00Z");
const post = (id: string, overrides: Partial<Publication> = {}): Publication => ({
  id, organization_id: "o", customer_id: "c1", title: `Post ${id}`, url: `https://nextdoor.com/p/${id}`, account_label: `Profile ${id}`,
  published_at: null, source: "sheet_import", created_at: "2026-10-26T10:00:00Z", visibility: "not_checked", last_observed_at: null, comments_total: null, recorded_session_id: null, ...overrides,
});

describe("sheetStatusUpdate uses only the sheet's own scenarios", () => {
  it("maps the three scenarios and leaves everything else blank", () => {
    expect(sheetStatusUpdate("alive", "live")).toBe("Alive");
    expect(sheetStatusUpdate("deleted_from_nd", "confirmed_removed")).toBe("Post Deleted from ND");
    expect(sheetStatusUpdate("proxy_issue", "live")).toBe("Proxy Issue");
    for (const outcome of ["unavailable", "login_required", "verification_required", "network_error", "profile_error", "needs_review"]) expect(sheetStatusUpdate(outcome, "live")).toBe("");
  });
  it("falls back to the visibility only for posts without a recorded check", () => {
    expect(sheetStatusUpdate(null, "live")).toBe("Alive");
    expect(sheetStatusUpdate(undefined, "confirmed_removed")).toBe("Post Deleted from ND");
    expect(sheetStatusUpdate(null, "unknown")).toBe("");
    expect(sheetStatusUpdate(null, "not_checked")).toBe("");
  });
  it("lets a later failed attempt win over an older live observation", () => {
    expect(sheetStatusUpdate("proxy_issue", "live")).toBe("Proxy Issue");
  });
});

describe("exportRows", () => {
  const posts = [
    post("a1", { visibility: "live", last_observed_at: "2026-10-27T10:00:00Z", last_check_outcome: "alive", last_checked_at: "2026-10-27T10:00:00Z" }),
    post("a2"),
    post("a3", { customer_id: "c2", visibility: "confirmed_removed", last_observed_at: "2026-10-27T09:00:00Z", last_check_outcome: "deleted_from_nd" }),
    post("a4", { visibility: "live", last_observed_at: "2026-10-27T11:00:00Z", last_check_outcome: "proxy_issue" }),
  ];
  const ids = (rows: unknown[][]) => rows.slice(1).map((row) => String(row[3]).split("/p/")[1]);

  it("starts with the headers and exports everything by default", () => {
    const rows = exportRows(posts, names, labels, { now });
    expect(rows[0]).toEqual([...EXPORT_HEADERS]);
    expect(ids(rows)).toEqual(["a1", "a2", "a3", "a4"]);
  });
  it("can limit to one customer", () => {
    expect(ids(exportRows(posts, names, labels, { customerId: "c2", now }))).toEqual(["a3"]);
  });
  it("needs_check keeps unchecked posts and failed attempts, not fresh good results", () => {
    expect(ids(exportRows(posts, names, labels, { scope: "needs_check", now }))).toEqual(["a2", "a4"]);
  });
  it("issues keeps removals and could-not-check results", () => {
    expect(ids(exportRows(posts, names, labels, { scope: "issues", now }))).toEqual(["a3", "a4"]);
  });
  it("fills the row with readable values", () => {
    const row = exportRows(posts, names, labels, { now })[1];
    expect(row.slice(0, 7)).toEqual(["Alpha Roofing", "Profile a1", "Post a1", "https://nextdoor.com/p/a1", "Alive", "Observed live", "Alive"]);
  });
});

describe("export is safe and round-trips through the importer", () => {
  it("neutralises spreadsheet formulas and starts with a BOM", () => {
    const csv = toCsv(exportRows([post("a1", { title: "=HYPERLINK(\"http://evil\")", account_label: "+cmd" })], names, labels, { now }));
    expect(csv.startsWith("\uFEFF\"Customer\"")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).toContain("\"'+cmd\"");
  });

  it("loads back through the CSV importer and the sheet's own status classifier", () => {
    const csv = toCsv(exportRows([
      post("a1", { visibility: "live", last_check_outcome: "alive" }),
      post("a3", { visibility: "confirmed_removed", last_check_outcome: "deleted_from_nd" }),
      post("a4", { visibility: "live", last_check_outcome: "proxy_issue" }),
    ], names, labels, { now }));
    const result = rowsFromCsv(csv);
    expect(result.error).toBeUndefined();
    expect(result.rows.map((row) => [row.profileName, classifyStatus(row.status, row.postLink)])).toEqual([["Profile a1", "alive"], ["Profile a3", "deleted"], ["Profile a4", "proxy_issue"]]);
    expect(result.rows[0].postLink).toBe("https://nextdoor.com/p/a1");
  });
});
