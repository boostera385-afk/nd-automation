import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), configured: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace }));
vi.mock("@/lib/sheet-sync", () => ({ sheetConnectionConfigured: mocks.configured }));
vi.mock("@/app/actions/sheet-setup", () => ({ testSavedSheetConnection: vi.fn(), saveSheetConnection: vi.fn(), clearSheetConnection: vi.fn() }));
import SheetSetup from "@/app/dashboard/settings/sheet-setup/page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.mockResolvedValue({ organization: { id: "11111111-1111-4111-8111-111111111111" } });
  mocks.configured.mockResolvedValue(false);
});

describe("internal Sheet setup wizard — 2 steps (rendered fixtures)", () => {
  it("requires staff access before exposing the wizard", async () => {
    mocks.workspace.mockRejectedValue(new Error("Denied"));
    await expect(SheetSetup()).rejects.toThrow("Denied");
    expect(mocks.workspace).toHaveBeenCalledWith(true);
    expect(mocks.configured).not.toHaveBeenCalled();
  });
  it("renders the 2-step flow: Google preparation, then save-in-dashboard", async () => {
    const html = renderToStaticMarkup(await SheetSetup());
    for (const heading of ["Step 1", "Step 2"]) expect(html).toContain(heading);
    expect(html).toContain("Copy connector code");
    expect(html).toContain("Save connection");
    expect(html).toContain("Test saved connection");
    expect(html).toContain("Advanced: hosted environment settings");
    expect(html).toContain("no hosting changes");
    // The workspace ID only appears in the collapsed advanced block, never as a step.
    expect(html).toContain("11111111-1111-4111-8111-111111111111");
    // A live-looking token is never rendered anywhere on the page.
    expect(html).not.toMatch(/SHEET_SYNC_TOKEN=[A-Za-z0-9_-]{24,}/);
    expect(html).toContain("does not activate posting");
    // Saving stays locked until the Sheet URL in step 1 is recognised.
    expect(html).toContain("nothing is read or imported until you test");
  });
  it("connected workspaces see replace, test and disconnect choices", async () => {
    mocks.configured.mockResolvedValue(true);
    const html = renderToStaticMarkup(await SheetSetup());
    expect(html).toContain("This workspace is connected");
    expect(html).toContain("Save (replace current)");
    expect(html).toContain("Disconnect this workspace");
    expect(html).toContain("The saved token is never shown on this page");
  });
  it("unconnected workspaces never see the disconnect choice", async () => {
    const html = renderToStaticMarkup(await SheetSetup());
    expect(html).not.toContain("Disconnect this workspace");
  });
});
