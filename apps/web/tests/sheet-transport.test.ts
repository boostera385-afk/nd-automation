import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), fetch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
import { fetchMasterRows, fetchSheetRows, sheetSyncConfigured } from "@/lib/sheet-sync";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const endpoint = "https://script.google.com/macros/s/fixture-script/exec";
const token = "test-only-token".repeat(3);
const result = { ok: true, sheet: "Auto Posting", fetchedAt: "2026-10-27T12:00:00Z", truncated: false, rows: [{ rowNumber: 2, profileName: "Authorized profile", title: "Short title", postLink: "", status: "" }] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHEET_SYNC_URL", endpoint); vi.stubEnv("SHEET_SYNC_TOKEN", token); vi.stubEnv("SHEET_SYNC_ORGANIZATION_ID", org);
  mocks.requireWorkspace.mockResolvedValue({ organization: { id: org } });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("workspace-scoped Sheet transport", () => {
  it("requires a configured owning workspace, not just a server-global token", () => {
    expect(sheetSyncConfigured(org)).toBe(true); expect(sheetSyncConfigured(otherOrg)).toBe(false);
    vi.stubEnv("SHEET_SYNC_ORGANIZATION_ID", ""); expect(sheetSyncConfigured(org)).toBe(false);
  });
  it("refuses another workspace's staff before contacting Google", async () => {
    mocks.requireWorkspace.mockResolvedValue({ organization: { id: otherOrg } });
    await expect(fetchMasterRows("Auto Posting")).rejects.toThrow("not configured for this workspace");
    expect(mocks.requireWorkspace).toHaveBeenCalledWith(true); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("respects the verified staff gate before sending connector credentials", async () => {
    mocks.requireWorkspace.mockRejectedValue(new Error("Not authorized"));
    await expect(fetchSheetRows("Auto Posting")).rejects.toThrow("Not authorized");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps the token in server-side POST transport and uses the expected allowlisted action", async () => {
    expect((await fetchMasterRows("Auto Posting")).rows).toHaveLength(1);
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(String(url)).toBe(endpoint);
    expect(options).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(options.body)).toEqual({ action: "getTaskRows", sheet: "Auto Posting", token });
  });
  it("retains the legacy safe-post action for link synchronization", async () => {
    await fetchSheetRows("Auto Posting");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).action).toBe("getPostRecords");
  });
  it("rejects unexpected credential fields and the wrong returned tab", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...result, rows: [{ ...result.rows[0], Password: "unsafe" }] })));
    await expect(fetchMasterRows("Auto Posting")).rejects.toThrow("unexpected response");
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...result, sheet: "Auto Listing" })));
    await expect(fetchMasterRows("Auto Posting")).rejects.toThrow("unexpected response");
  });
  it("handles older connector versions with an upgrade notice, never replaces a live script", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "invalid_action" })));
    await expect(fetchMasterRows("Auto Posting")).rejects.toThrow("desktop and Fudge scripts should not be replaced");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
