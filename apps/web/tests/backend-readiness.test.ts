import { describe, expect, it } from "vitest";
import { backendReadiness } from "@/lib/backend-readiness";

const ref = "xtefjnfdjnxwrpkoydaj";
const valid = {
  expectedProjectRef: ref,
  configuredProjectRef: ref,
  publicConfig: { url: `https://${ref}.supabase.co`, key: "sb_publishable_fixture_only" },
  appUrl: "http://localhost:3000",
  sheetUrl: "https://script.google.com/macros/s/fixture_deployment/exec",
  sheetToken: "fixture_token_not_a_real_secret_123",
  sheetOrganizationId: "11111111-1111-4111-8111-111111111111",
};
const status = (input: Parameters<typeof backendReadiness>[0], id: string) => backendReadiness(input).checks.find((check) => check.id === id)?.status;

describe("offline backend readiness", () => {
  it("distinguishes configured settings from hosted readiness", () => {
    const report = backendReadiness(valid);
    expect(report.localConfigurationReady).toBe(true);
    expect(report.hostedReadiness).toBe("unverified");
    expect(report.checks.filter((check) => check.status === "unverified").map((check) => check.id)).toEqual(["hosted_database", "hosted_auth", "recovery", "worker"]);
  });
  it("reports missing configuration without throwing", () => {
    expect(backendReadiness({ expectedProjectRef: ref, publicConfig: null }).localConfigurationReady).toBe(false);
  });
  it.each([undefined, "", "tyczcognqypqxrvkbmrk", "invalid"])("blocks a missing or wrong pin: %s", (configuredProjectRef) => {
    expect(status({ ...valid, configuredProjectRef }, "project_pin")).toBe("blocked");
  });
  it("requires the runtime validator to accept client configuration", () => {
    expect(status({ ...valid, publicConfig: null }, "client_configuration")).toBe("blocked");
  });
  it.each(["https://tyczcognqypqxrvkbmrk.supabase.co", `https://${ref}.supabase.co.attacker.test`, `https://${ref}.supabase.co/rest/v1`, `https://user:password@${ref}.supabase.co`])("blocks an incorrect origin: %s", (url) => {
    expect(status({ ...valid, publicConfig: { ...valid.publicConfig, url } }, "client_configuration")).toBe("blocked");
  });
  it.each(["http://remote.example", "https://user:password@app.example", "https://app.example/path", "https://app.example?token=hidden", "invalid"])("blocks unsafe canonical app URLs: %s", (appUrl) => {
    expect(status({ ...valid, appUrl }, "app_origin")).toBe("blocked");
  });
  it.each(["https://script.google.com.attacker.test/macros/s/fixture/exec", "http://script.google.com/macros/s/fixture/exec", "https://script.google.com/macros/s/fixture/exec?token=hidden", "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec", "https://script.google.com/macros/s/fixture/dev"])("blocks unsafe or placeholder connector URLs: %s", (sheetUrl) => {
    expect(status({ ...valid, sheetUrl }, "sheet_endpoint")).toBe("blocked");
  });
  it("blocks invalid token/workspace shapes", () => {
    expect(status({ ...valid, sheetToken: "short" }, "sheet_token")).toBe("blocked");
    expect(status({ ...valid, sheetOrganizationId: "not-a-workspace" }, "sheet_workspace")).toBe("blocked");
  });
  it("never echoes settings, including malformed secrets and endpoints", () => {
    const sensitive = "DO_NOT_PRINT_fixture_credentials";
    const report = backendReadiness({ ...valid, publicConfig: { url: sensitive, key: sensitive }, appUrl: sensitive, sheetUrl: sensitive, sheetToken: sensitive, sheetOrganizationId: sensitive });
    const output = JSON.stringify(report);
    expect(output).not.toContain(sensitive);
    expect(output).not.toContain(valid.sheetUrl);
    expect(output).not.toContain(valid.sheetToken);
    expect(output).not.toContain(valid.publicConfig.key);
  });
});
