import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), fetch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
import { fetchMasterLayout, fetchMasterRows, fetchMasterSections, fetchSheetRows, sheetSyncConfigured } from "@/lib/sheet-sync";

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
    await expect(fetchMasterRows("Auto Posting")).rejects.toThrow("Fudge script should not be replaced");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("distinguishes a missing tab from invalid headers without treating either as empty success", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "sheet_not_found" })));
    await expect(fetchMasterRows("Bulk proxies import")).rejects.toMatchObject({ code: "sheet_not_found" });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "status_column_missing" })));
    await expect(fetchMasterRows("Bulk proxies import")).rejects.toMatchObject({ code: "sheet_unavailable" });
  });
});

describe("dated-plan section transport", () => {
  const sectionsResult = {
    ok: true,
    action: "getMasterSections",
    sheet: "New Optimize Structure",
    fetchedAt: "2026-11-04T12:00:00.000Z",
    linkHeader: "Issues",
    linkColumnSource: "declared",
    columns: { profile: "M", link: "K", status: "L", title: "F", service: "A", area: "I", state: "J" },
    sections: [{
      planDate: "2026-11-04",
      bannerRow: 1,
      headerRow: 2,
      fromRow: 3,
      toRow: 3,
      columns: { profile: "M", link: "K", status: "L", title: "F", service: "A", area: "I", state: "J" },
      rows: [{ rowNumber: 3, profileName: "Authorized profile", postLink: "https://nextdoor.com/p/AbC123", status: "Posted", title: "Short title", service: "Service", area: "Area", state: "State" }],
      rejectedLinks: 0,
    }],
    warnings: [],
    truncated: false,
    returnedRows: 1,
  };

  it("sends the declared link header and parses the safe projection", async () => {
    vi.stubEnv("SHEET_MASTER_LINK_HEADER", "Issues");
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(sectionsResult)));
    const data = await fetchMasterSections("New Optimize Structure");
    expect(data.sections[0].rows[0].postLink).toBe("https://nextdoor.com/p/AbC123");
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(String(url)).toBe(endpoint);
    expect(JSON.parse(options.body)).toEqual({ action: "getMasterSections", sheet: "New Optimize Structure", linkHeader: "Issues", token });
  });

  it("allows an explicit header per request without exposing the token", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(sectionsResult)));
    await fetchMasterSections("New Optimize Structure", "Post Link");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).linkHeader).toBe("Post Link");
    expect(JSON.stringify(mocks.fetch.mock.calls[0][1].body)).not.toContain("Bearer");
  });

  it("rejects an unexpected field instead of accepting a credential column", async () => {
    const leaky = { ...sectionsResult, sections: [{ ...sectionsResult.sections[0], rows: [{ ...sectionsResult.sections[0].rows[0], phone: "555-0100" }] }] };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(leaky)));
    await expect(fetchMasterSections("New Optimize Structure")).rejects.toThrow("unexpected response");
  });

  it("asks for a connector redeploy on an older deployment", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "invalid_action" })));
    await expect(fetchMasterSections("New Optimize Structure")).rejects.toThrow("Redeploy the current read-only script");
  });

  it("refuses another workspace's staff before contacting Google", async () => {
    mocks.requireWorkspace.mockResolvedValue({ organization: { id: otherOrg } });
    await expect(fetchMasterSections("New Optimize Structure")).rejects.toThrow("not configured for this workspace");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("explains missing script properties instead of blaming the network", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "not_configured" })));
    await expect(fetchMasterSections("Sheet1")).rejects.toThrow("no SHEET_ID or SYNC_TOKEN script property");
  });
});

describe("workbook structure transport", () => {
  const layoutResult = {
    ok: true,
    action: "getMasterLayout",
    fetchedAt: "2026-11-04T10:00:00.000Z",
    tabCount: 1,
    truncated: false,
    tabs: [{ name: "Sheet1", rows: 253, columns: 17, headerRow: 2, planDate: "2026-11-04", labels: [{ column: "M", label: "account name" }], unrecognisedHeaders: 1 }],
  };

  it("asks for structure only, without a tab name or a link header", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(layoutResult)));
    const data = await fetchMasterLayout();
    expect(data.tabs[0]).toMatchObject({ name: "Sheet1", rows: 253, headerRow: 2, planDate: "2026-11-04" });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ action: "getMasterLayout", token });
  });

  it("rejects a tab payload that carries cell text it was not asked for", async () => {
    const leaky = { ...layoutResult, tabs: [{ ...layoutResult.tabs[0], values: ["Bertha Estes"] }] };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(leaky)));
    await expect(fetchMasterLayout()).rejects.toThrow("unexpected response");
  });

  it("never prints the token in a layout error", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "unauthorized" })));
    let failure = "";
    try { await fetchMasterLayout(); } catch (cause) { failure = (cause as Error).message; }
    expect(failure).toContain("rejected the secret token");
    expect(failure).not.toContain(token);
  });
});
