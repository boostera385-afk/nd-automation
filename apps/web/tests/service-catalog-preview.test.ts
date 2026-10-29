import { describe, expect, it } from "vitest";
import { previewServiceCatalog, CATALOG_MAX_BYTES } from "@/lib/service-catalog-preview";

const row = { "Service Keyword": "Fixture repair", "Search Term": "fixture repair", "Service Family": "Fixtures", Subcategory: "Fixture repair", "Topic Filter Required": "YES", "Collect Family Reviews": "false", "Business Name Keywords": "fixture;repair|fixture", "Review Keywords": "repair\nfixed", "Google Filter Keywords": "fixture", "Exclude Keywords": "", "Required Review Keywords": "", _sheet_row: 2 };
const preview = (services: unknown[], extra = {}) => previewServiceCatalog(JSON.stringify({ services, ...extra }));
describe("local service catalog validation", () => {
  it("preserves original keyword and classification, and parses flags and existing signal delimiters", () => {
    const result = preview([row]);
    expect(result.valid).toBe(true);
    expect(result.rules[0]).toMatchObject({ keyword: "Fixture repair", family: "Fixtures", topicRequired: true, collectFamilyInventory: false, businessSignals: ["fixture", "repair"], reviewSignals: ["repair", "fixed"], requiredSignals: [], excludeSignals: [] });
  });
  it("rejects invalid JSON without echoing the supplied input", () => {
    const result = previewServiceCatalog("PRIVATE_INVALID_DATA");
    expect(result.valid).toBe(false); expect(JSON.stringify(result)).not.toContain("PRIVATE_INVALID_DATA");
  });
  it("rejects oversized UTF-8 content", () => {
    expect(previewServiceCatalog("é".repeat(CATALOG_MAX_BYTES / 2 + 1)).errors[0]).toContain("1 MiB");
  });
  it.each([{ rows: [] }, { rows: Array.from({ length: 501 }, () => row) }])("bounds the number of rules", ({ rows }) => {
    expect(preview(rows).valid).toBe(false);
  });
  it("rejects unrecognized row columns and excessive or control-character cells", () => {
    for (const value of [{ ...row, password: "DO_NOT_ECHO" }, { ...row, Notes: "x".repeat(8001) }, { ...row, Notes: "\u0000" }]) {
      const result = preview([value]); expect(result.valid).toBe(false); expect(result.rules).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("DO_NOT_ECHO");
    }
  });
  it("detects collector-normalization collisions instead of silently merging rules", () => {
    const result = preview([row, { ...row, "Service Keyword": "Fixture-repair,", _sheet_row: 3 }]);
    expect(result.valid).toBe(false); expect(result.errors.join(" ")).toContain("collides with row 2");
  });
  it.each(["", "perhaps"])("does not invent a boolean for %s", (flag) => {
    const result = preview([{ ...row, "Topic Filter Required": flag }]);
    expect(result.valid).toBe(false); expect(result.rules[0].topicRequired).toBeNull();
  });
  it("requires explicit family, subcategory and search term rather than repairs fallback", () => {
    const result = preview([{ ...row, "Service Family": "", Subcategory: "", "Search Term": "" }]);
    expect(result.valid).toBe(false); expect(result.errors.join(" ")).toContain("no fallback classification");
  });
  it("flags unmatched exact keywords without inferring family equivalence", () => {
    const result = preview([row], { structure_keywords_not_in_services: ["fixture repair", "Fixture-repair", "Another service"] });
    expect(result.unmatched).toEqual(["Fixture-repair", "Another service"]);
    expect(result.warnings.join(" ")).toContain("Family rules may cover them");
  });
  it("ignores historical activation claims and does not expose notes in the preview model", () => {
    const result = preview([{ ...row, Status: "Active", Notes: "PRIVATE_NOTES" }], { approved_for_activation: true, imported_to_backend: true });
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toContain("not permission to activate");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_NOTES");
  });
  it("retains commas inside signal phrases instead of inventing extra tokens", () => {
    expect(preview([{ ...row, "Review Keywords": "repair, install" }]).rules[0].reviewSignals).toEqual(["repair, install"]);
  });
});
