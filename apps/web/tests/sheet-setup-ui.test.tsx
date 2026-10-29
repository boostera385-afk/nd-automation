import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), configured: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace }));
vi.mock("@/lib/sheet-sync", () => ({ sheetSyncConfigured: mocks.configured }));
vi.mock("@/app/actions/sheet-setup", () => ({ testSavedSheetConnection: vi.fn() }));
import SheetSetup from "@/app/dashboard/settings/sheet-setup/page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.mockResolvedValue({ organization: { id: "11111111-1111-4111-8111-111111111111" } });
  mocks.configured.mockReturnValue(false);
});

describe("internal Sheet setup wizard (rendered fixtures)", () => {
  it("requires staff access before exposing the wizard", async () => {
    mocks.workspace.mockRejectedValue(new Error("Denied"));
    await expect(SheetSetup()).rejects.toThrow("Denied");
    expect(mocks.workspace).toHaveBeenCalledWith(true);
    expect(mocks.configured).not.toHaveBeenCalled();
  });
  it("renders numbered instructions, bundled code copy and saved-config test", async () => {
    const html = renderToStaticMarkup(await SheetSetup());
    for (const heading of ["1. Choose", "2. Create", "3. Add", "4. Deploy", "5. Copy", "6. Test"]) expect(html).toContain(heading);
    expect(html).toContain("Copy connector code");
    expect(html).toContain("Test saved connection");
    expect(html).toContain("does not write server files");
    expect(html).toContain("11111111-1111-4111-8111-111111111111");
    // The complete three-line block is always visible, but only with placeholders until real inputs exist.
    expect(html).toContain("SHEET_SYNC_URL=&lt;paste the /exec Web app URL from step 4&gt;");
    expect(html).toContain("SHEET_SYNC_TOKEN=&lt;paste the SYNC_TOKEN value from step 3&gt;");
    expect(html).not.toMatch(/SHEET_SYNC_TOKEN=[A-Za-z0-9_-]{24,}/);
    expect(html).toContain("does not activate posting");
  });
  it("warns connected organizations to reuse the connection instead of rotating it per user", async () => {
    mocks.configured.mockReturnValue(true);
    const html = renderToStaticMarkup(await SheetSetup());
    expect(html).toContain("A server connection is already configured");
    expect(html).toContain("Its saved token is never sent to this page");
    expect(html).toContain("I intend to replace the existing connection");
    expect(html).toMatch(/disabled=""[^>]*>Generate private token/);
  });
});
