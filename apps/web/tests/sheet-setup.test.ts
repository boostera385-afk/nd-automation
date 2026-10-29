import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractSpreadsheetId, generateSetupToken, sheetEnvironmentSnippet, sheetEnvironmentTemplate, sheetSetupGaps, validSetupToken } from "@/lib/sheet-setup";
import { SHEET_CONNECTOR_SOURCE } from "@/generated/sheet-connector";

const id = "fixture_spreadsheet_id_123456789";
const token = "a".repeat(64);
const workspace = "11111111-1111-4111-8111-111111111111";
const endpoint = "https://script.google.com/macros/s/fixture-deployment/exec";

describe("internal Sheet setup helpers", () => {
  it("extracts only the spreadsheet ID, not a gid or workspace ID", () => {
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=123#gid=123`)).toBe(id);
    expect(extractSpreadsheetId(id)).toBe(id);
    expect(extractSpreadsheetId(workspace)).toBeNull();
    expect(extractSpreadsheetId("https://internal.example/dashboard/settings")).toBeNull();
  });
  it.each(["", "short", "http://docs.google.com/spreadsheets/d/fixture_spreadsheet_id_123456789/edit", "https://docs.google.com.attacker.test/spreadsheets/d/fixture_spreadsheet_id_123456789/edit", "https://user:password@docs.google.com/spreadsheets/d/fixture_spreadsheet_id_123456789/edit", "https://script.google.com/macros/s/fixture/exec"])("rejects invalid Sheet input: %s", (input) => {
    expect(extractSpreadsheetId(input)).toBeNull();
  });
  it("generates independent 256-bit tokens with Web Crypto", () => {
    const first = generateSetupToken(), second = generateSetupToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(validSetupToken(first)).toBe(true);
  });
  it("generates exactly the three server settings with the workspace inserted", () => {
    expect(sheetEnvironmentSnippet(endpoint, token, workspace)).toBe(`SHEET_SYNC_URL=${endpoint}\nSHEET_SYNC_TOKEN=${token}\nSHEET_SYNC_ORGANIZATION_ID=${workspace}`);
  });
  it.each(["short", "a".repeat(257), token + "\nOTHER=value", token + "#comment", token + " "])("rejects invalid or injectable token values", (value) => {
    expect(sheetEnvironmentSnippet(endpoint, value, workspace)).toBeNull();
  });
  it.each([endpoint + "?token=hidden", endpoint + "#hidden", "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec", "https://attacker.test/macros/s/fixture/exec"])("rejects unsafe connector input", (value) => {
    expect(sheetEnvironmentSnippet(value, token, workspace)).toBeNull();
  });
  it("requires an actual workspace UUID shape", () => {
    expect(sheetEnvironmentSnippet(endpoint, token, "not-a-workspace")).toBeNull();
  });
  it("names exactly which inputs are still missing", () => {
    expect(sheetSetupGaps(endpoint, token)).toEqual([]);
    expect(sheetSetupGaps("", token)).toEqual(["the connector Web app URL ending in /exec (step 4)"]);
    expect(sheetSetupGaps(endpoint, "")).toEqual(["the 24–256 character SYNC_TOKEN value (step 3)"]);
    expect(sheetSetupGaps("", "")).toHaveLength(2);
    expect(sheetSetupGaps("https://attacker.test/macros/s/fixture/exec", "short")).toHaveLength(2);
    expect(sheetSetupGaps(endpoint + "?token=hidden", token)).toEqual([]);
  });
  it("always renders the complete three-line block with visible placeholders", () => {
    expect(sheetEnvironmentTemplate("", "", workspace)).toBe("SHEET_SYNC_URL=<paste the /exec Web app URL from step 4>\nSHEET_SYNC_TOKEN=<paste the SYNC_TOKEN value from step 3>\nSHEET_SYNC_ORGANIZATION_ID=" + workspace);
    expect(sheetEnvironmentTemplate(endpoint, "", workspace)).toBe(`SHEET_SYNC_URL=${endpoint}\nSHEET_SYNC_TOKEN=<paste the SYNC_TOKEN value from step 3>\nSHEET_SYNC_ORGANIZATION_ID=${workspace}`);
    expect(sheetEnvironmentTemplate(endpoint, token, workspace)).toBe(sheetEnvironmentSnippet(endpoint, token, workspace));
  });
  it("never embeds an invalid or injectable value in the template", () => {
    for (const bad of ["short", "a".repeat(257), token + "\nOTHER=value", token + " "]) {
      const block = sheetEnvironmentTemplate(endpoint, bad, workspace);
      expect(block).not.toContain(bad);
      expect(block.split("\n")).toHaveLength(3);
    }
    for (const bad of [endpoint + "?token=hidden", "https://attacker.test/macros/s/fixture/exec"]) {
      const block = sheetEnvironmentTemplate(bad, token, workspace);
      expect(block).not.toContain("attacker");
      expect(block).not.toContain("hidden");
      expect(block.split("\n")).toHaveLength(3);
    }
  });
  it("bundles the exact canonical connector, not a separately maintained copy", async () => {
    const canonical = await readFile(new URL("../../../integrations/sheets/reporting-sync.gs", import.meta.url), "utf8");
    expect(SHEET_CONNECTOR_SOURCE).toBe(canonical);
    expect(SHEET_CONNECTOR_SOURCE).toContain('props.getProperty("SYNC_TOKEN")');
    expect(SHEET_CONNECTOR_SOURCE).not.toContain("sb_publishable_");
    expect(SHEET_CONNECTOR_SOURCE).not.toContain("sb_secret_");
  });
});
