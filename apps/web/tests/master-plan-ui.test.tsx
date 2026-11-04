import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), configured: vi.fn(), layout: vi.fn(), sections: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("@/lib/sheet-sync", () => ({
  sheetConnectionConfigured: mocks.configured,
  fetchMasterLayout: mocks.layout,
  fetchMasterSections: mocks.sections,
  SheetSyncError: class extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
}));
vi.mock("@/components/live-refresh", () => ({ LiveRefresh: () => <button>Refresh</button> }));

import DatedPlan from "@/app/dashboard/master-sheet/plan/page";
import { SheetSyncError } from "@/lib/sheet-sync";
import type { MasterLayout, MasterSection, MasterSections } from "@/lib/master-sections";

const layout = (overrides: Partial<MasterLayout> = {}): MasterLayout => ({
  ok: true,
  action: "getMasterLayout",
  fetchedAt: "2026-11-04T10:00:00.000Z",
  tabCount: 1,
  truncated: false,
  tabs: [{ name: "Sheet1", rows: 253, columns: 17, headerRow: 2, planDate: "2026-11-04", labels: [{ column: "K", label: "issues" }], unrecognisedHeaders: 1 }],
  ...overrides,
});

type PlanRow = MasterSection["rows"][number];
const row = (overrides: Partial<PlanRow> = {}): PlanRow => ({
  rowNumber: 3,
  profileName: "Profile One",
  postLink: "https://nextdoor.com/p/AbC123",
  status: "Posted",
  title: "Short title",
  service: "Garage Door Repair",
  area: "Chicago",
  state: "Illinois",
  ...overrides,
});

const section = (overrides: Partial<MasterSection> = {}): MasterSection => ({
  planDate: "2026-11-04",
  bannerRow: 1,
  headerRow: 2,
  fromRow: 3,
  toRow: 5,
  columns: { service: "A", title: "F", area: "I", state: "J", link: "K", status: "L", profile: "M" },
  rows: [
    row(),
    row({ rowNumber: 4, profileName: "Profile Two", postLink: "", status: "", title: "", service: "", area: "", state: "" }),
    row({ rowNumber: 5, profileName: "", postLink: "", status: "Issue: proxy dead", title: "", service: "", area: "", state: "" }),
  ],
  rejectedLinks: 0,
  ...overrides,
});

const sections = (overrides: Partial<MasterSections> = {}): MasterSections => ({
  ok: true,
  action: "getMasterSections",
  sheet: "Sheet1",
  fetchedAt: "2026-11-04T10:00:00.000Z",
  linkHeader: "Issues",
  linkColumnSource: "declared",
  columns: { service: "A", title: "F", area: "I", state: "J", link: "K", status: "L", profile: "M" },
  sections: [section()],
  warnings: [],
  truncated: false,
  returnedRows: 3,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ organization: { id: "11111111-1111-4111-8111-111111111111", time_zone: "America/Los_Angeles" } });
  mocks.configured.mockReturnValue(true);
  mocks.layout.mockResolvedValue(layout());
  mocks.sections.mockResolvedValue(sections());
});

const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await DatedPlan({ searchParams: Promise.resolve(params) }));

describe("dated plan view (fixtures, no live browser)", () => {
  it("auto-selects the only populated tab and renders the section counts", async () => {
    const html = await render();
    expect(mocks.sections).toHaveBeenCalledWith("Sheet1");
    expect(html).toContain("Plan for 2026-11-04");
    expect(html).toContain("Rows 3–5 · header row 2");
    expect(html).toContain("3 tasks · saved links 1 · posted claim with link 1 · posted claim without link 0");
    expect(html).not.toContain('role="alert"');
  });

  it("keeps a Sheet status a claim and never calls it verified", async () => {
    const html = await render();
    expect(html).toContain("Posted (Sheet claim)");
    expect(html).toContain("A Sheet label, not a verified observation");
    expect(html).not.toMatch(/verified observation:/i);
  });

  it("reports rows without an Account Name instead of inventing a profile", async () => {
    const html = await render();
    expect(html).toContain("Missing Account Name");
    expect(html).toContain("1 of 3 rows have no Account Name in this section");
    expect(html).toContain("Nothing was filled in");
  });

  it("shows unrecognised status text verbatim", async () => {
    const html = await render();
    expect(html).toContain("Other status text in the Sheet");
    expect(html).toContain("Issue: proxy dead");
  });

  it("surfaces refused link cells and partial reads honestly", async () => {
    const payload = sections();
    payload.sections[0].rejectedLinks = 2;
    payload.sections[0].truncated = true;
    payload.truncated = true;
    mocks.sections.mockResolvedValue(payload);
    const html = await render();
    expect(html).toContain("2 link cells in this section were not exact Nextdoor share URLs and were refused");
    expect(html).toContain("This section was cut off at the connector");
    expect(html).toContain("these counts are a floor, not a total");
  });

  it("stops reading links when no link column is declared or recognised", async () => {
    const payload = sections({ linkColumnSource: null, warnings: ["link_column_missing"] });
    payload.sections[0].rows = [row({ postLink: "" })];
    mocks.sections.mockResolvedValue(payload);
    const html = await render();
    expect(html).toContain("no post-link column was recognised or declared");
    expect(html).toContain("No post-link column was recognised or declared");
  });

  it("does not assume a date for a section without a banner", async () => {
    const payload = sections();
    payload.sections[0].planDate = null;
    payload.sections[0].bannerRow = null;
    mocks.sections.mockResolvedValue(payload);
    const html = await render();
    expect(html).toContain("Section with no date banner");
    expect(html).toContain("It is not assumed to be today");
  });

  it("does not contact Google when the workspace is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    const html = await render();
    expect(mocks.layout).not.toHaveBeenCalled();
    expect(mocks.sections).not.toHaveBeenCalled();
    expect(html).toContain("Connect your master Sheet once");
  });

  it("offers a tab choice when the workbook holds more than one populated tab", async () => {
    mocks.layout.mockResolvedValue(layout({
      tabCount: 2,
      tabs: [
        { name: "Sheet1", rows: 253, columns: 17, headerRow: 2, planDate: "2026-11-04", labels: [], unrecognisedHeaders: 0 },
        { name: "Archive", rows: 40, columns: 9, headerRow: 1, planDate: null, labels: [], unrecognisedHeaders: 0 },
      ],
    }));
    const html = await render();
    expect(html).toContain("Choose a tab");
    expect(html).toContain('href="/dashboard/master-sheet/plan?tab=Archive"');
    expect(mocks.sections).not.toHaveBeenCalled();
  });

  it("lists the real tabs when a requested tab name does not exist", async () => {
    mocks.sections.mockRejectedValue(new SheetSyncError("sheet_not_found", "That tab does not exist in the connected Sheet. Nothing was changed."));
    const html = await render({ tab: "Typo tab" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("That tab does not exist");
    expect(html).toContain('href="/dashboard/master-sheet/plan?tab=Sheet1"');
  });

  it("explains an unconfigured connector deployment instead of showing a Google error", async () => {
    mocks.sections.mockRejectedValue(new SheetSyncError("not_configured", "The connector deployment has no SHEET_ID or SYNC_TOKEN script property yet."));
    const html = await render({ tab: "Sheet1" });
    expect(html).toContain("no SHEET_ID or SYNC_TOKEN script property yet");
  });

  it("never renders a phone, remarks or pictures column, because none is requested", async () => {
    const html = await render();
    expect(html).not.toContain("(872) 278-7204");
    expect(html).not.toContain("private remark");
    const body = JSON.stringify(mocks.sections.mock.calls[0] ?? []);
    for (const forbidden of ["phone", "remarks", "pictures", "password", "cookies", "proxy"]) expect(body.toLowerCase()).not.toContain(forbidden);
  });
});
