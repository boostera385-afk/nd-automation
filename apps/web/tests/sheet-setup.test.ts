import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractSpreadsheetId, generateSetupToken, sheetEnvironmentSnippet, validSetupToken } from "@/lib/sheet-setup";
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
  it("bundles the exact canonical connector, not a separately maintained copy", async () => {
    const canonical = await readFile(new URL("../../../integrations/sheets/reporting-sync.gs", import.meta.url), "utf8");
    expect(SHEET_CONNECTOR_SOURCE).toBe(canonical);
    expect(SHEET_CONNECTOR_SOURCE).toContain('props.getProperty("SYNC_TOKEN")');
    expect(SHEET_CONNECTOR_SOURCE).not.toContain("sb_publishable_");
    expect(SHEET_CONNECTOR_SOURCE).not.toContain("sb_secret_");
  });
});
