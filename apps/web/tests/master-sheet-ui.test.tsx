import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), configured: vi.fn(), fetchRows: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("@/lib/sheet-sync", () => ({
  sheetSyncConfigured: mocks.configured,
  fetchMasterRows: mocks.fetchRows,
  SheetSyncError: class extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
}));
vi.mock("@/components/live-refresh", () => ({ LiveRefresh: () => <button>Refresh</button> }));
vi.mock("@/components/action-form", () => ({ ActionForm: ({ label }: { label: string }) => <button>{label}</button> }));
vi.mock("@/app/actions/workflow", () => ({ syncMappedPosts: vi.fn() }));

import MasterSheet from "@/app/dashboard/master-sheet/page";
import { SheetSyncError } from "@/lib/sheet-sync";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ organization: { id: "11111111-1111-4111-8111-111111111111", time_zone: "America/Los_Angeles" } });
  mocks.configured.mockReturnValue(true);
});
const render = async (tab: string) => renderToStaticMarkup(await MasterSheet({ searchParams: Promise.resolve({ tab }) }));

describe("Master Sheet optional missing-tab UI (fixtures, no live browser)", () => {
  it("shows a non-error proxy-tab notice with the cookie alias link and no import action", async () => {
    mocks.fetchRows.mockRejectedValue(new SheetSyncError("sheet_not_found", "Missing"));
    const html = await render("Bulk proxies import");
    expect(html).toContain("Optional proxy-import tab not configured");
    expect(html).toContain('href="/dashboard/master-sheet?tab=Bulk%20cookies%20import"');
    expect(html).toContain("Cookie and proxy imports are different tasks");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Sync known profiles now");
  });
  it("does not hide missing required posting tabs", async () => {
    mocks.fetchRows.mockRejectedValue(new SheetSyncError("sheet_not_found", "Posting tab missing"));
    const html = await render("Auto Posting");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Posting tab missing");
    expect(html).not.toContain("Optional proxy-import tab not configured");
  });
  it.each(["unauthorized", "sheet_unavailable", "bad_response", "unreachable"] as const)("retains actual %s failures even on the optional tab", async (code) => {
    mocks.fetchRows.mockRejectedValue(new SheetSyncError(code, "Actual failure"));
    const html = await render("Bulk proxies import");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Actual failure");
    expect(html).not.toContain("Optional proxy-import tab not configured");
  });
  it("still renders the safe cookie metadata preview without offering import execution", async () => {
    mocks.fetchRows.mockResolvedValue({ fetchedAt: "2026-10-28T12:00:00Z", truncated: false, rows: [{ rowNumber: 2, profileName: "Fixture profile", title: "", status: "Imported 10 cookies", postLink: "" }] });
    const html = await render("Bulk cookies import");
    expect(html).toContain("Fixture profile");
    expect(html).toContain("Imported 10 cookies");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Sync known profiles now");
  });
  it("does not contact Google when the owning workspace is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    const html = await render("Bulk proxies import");
    expect(mocks.fetchRows).not.toHaveBeenCalled();
    expect(html).toContain("Connect your master Sheet once");
    expect(html).not.toContain("Optional proxy-import tab not configured");
  });
});
