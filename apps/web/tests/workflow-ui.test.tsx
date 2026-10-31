import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ path: "/dashboard", getContext: vi.fn(), requireWorkspace: vi.fn(), getDashboardData: vi.fn(), getOperationsData: vi.fn(), sheetSyncConfigured: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path, useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: ({ href, children, className, "aria-current": current }: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => <a href={href} className={className} aria-current={current}>{children}</a> }));
vi.mock("@/lib/data", () => ({ getContext: mocks.getContext, requireWorkspace: mocks.requireWorkspace, getDashboardData: mocks.getDashboardData }));
vi.mock("@/lib/operations-data", () => ({ getOperationsData: mocks.getOperationsData }));
vi.mock("@/lib/sheet-sync", () => ({ sheetSyncConfigured: mocks.sheetSyncConfigured }));
vi.mock("@/app/actions/reporting", () => ({ createWorkspace: vi.fn() }));
vi.mock("@/app/actions/workflow", () => ({ setBatchMonitoring: vi.fn() }));
vi.mock("@/app/actions/automation-tasks", () => ({ enqueueBrowserTask: vi.fn(), cancelBrowserTask: vi.fn(), reconcileExpiredBrowserTask: vi.fn() }));

import Home from "@/app/dashboard/page";
import RunAutomation from "@/app/dashboard/run/page";
import Responses from "@/app/dashboard/responses/page";
import { Navigation } from "@/components/navigation";

const organization = { id: "11111111-1111-4111-8111-111111111111", name: "Fixture workspace", time_zone: "America/Los_Angeles" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.path = "/dashboard";
  mocks.getContext.mockResolvedValue({ organization, isStaff: true });
  mocks.requireWorkspace.mockResolvedValue({ organization, isStaff: true });
  mocks.getDashboardData.mockResolvedValue({ publications: [], customers: [], comments: [], session: null, truncated: false });
  mocks.getOperationsData.mockResolvedValue({ workers: [], bindings: [], jobs: [], tasks: [], profiles: [], tasksLimited: false, automationAvailable: true, available: true, limited: false, loadedAt: Date.parse("2026-10-27T12:00:00Z") });
  mocks.sheetSyncConfigured.mockReturnValue(false);
});

describe("rendered sheet-first UI (fixture data; not hosted auth acceptance)", () => {
  it("renders only five daily sections plus Settings for staff", () => {
    const html = renderToStaticMarkup(<Navigation isStaff />);
    expect((html.match(/<a /g) ?? []).length).toBe(6);
    for (const label of ["Home", "Master Sheet", "Run automation", "Profiles", "Results", "Settings / More"]) expect(html).toContain(label);
    for (const old of ["href=\"/dashboard/posts/new\"", "href=\"/dashboard/publishing\"", "href=\"/dashboard/content\"", "href=\"/dashboard/automation\""]) expect(html).not.toContain(old);
  });
  it("does not expose operational navigation to customer viewers", () => {
    const html = renderToStaticMarkup(<Navigation />);
    expect((html.match(/<a /g) ?? []).length).toBe(3);
    expect(html).not.toContain("Master Sheet"); expect(html).not.toContain("Run automation"); expect(html).not.toContain("Profiles");
  });
  it("keeps advanced routes visibly grouped under Settings", () => {
    mocks.path = "/dashboard/automation";
    const html = renderToStaticMarkup(<Navigation isStaff />);
    expect(html).toMatch(/href="\/dashboard\/settings" class="active" aria-current="page"/);
  });
  it("makes Sheet and run controls the home workflow, without a manual-entry checklist", async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("MASTER SHEET"); expect(html).toContain("LOCAL LAPTOP"); expect(html).toContain("saved mappings");
    expect(html).not.toContain("Setup checklist"); expect(html).not.toContain("Keep the session honest");
    expect(html).not.toContain('href="/dashboard/posts/new"');
    expect(html).toContain("still gated");
  });
  it("renders customer home without loading any operations data", async () => {
    mocks.getContext.mockResolvedValue({ organization, isStaff: false });
    const html = renderToStaticMarkup(await Home());
    expect(mocks.getOperationsData).not.toHaveBeenCalled();
    expect(html).not.toContain("LOCAL LAPTOP"); expect(html).toContain("View results");
  });
  it("offers only executable browser tasks and names what stays gated", async () => {
    mocks.getOperationsData.mockResolvedValueOnce({ workers: [{ id: "22222222-2222-4222-8222-222222222222", name: "Fixture laptop", enabled: true, last_seen_at: null }], bindings: [], jobs: [], tasks: [], profiles: [], tasksLimited: false, automationAvailable: true, available: true, limited: false, loadedAt: Date.now() });
    const html = renderToStaticMarkup(await RunAutomation());
    expect(html).not.toContain("Desktop only");
    expect(html).not.toContain("Start posting"); expect(html).not.toContain("Create accounts now");
    expect(html).toContain("Post checks &amp; comments");
    expect(html).toContain("Browser tasks");
    for (const label of ["Import cookies into a profile", "Set a profile&#x27;s proxy", "Create Incogniton profile", "Read preset inventory"]) expect(html).toContain(label);
    for (const label of ["Auto Posting", "Auto Listing", "ND Acc Creation", "Content presets / warmup"]) expect(html).toContain(label);
    expect(html).toContain("Gated");
  });
  it("keeps Home to counts only and moves threads to Responses", async () => {
    const observed = new Date().toISOString();
    mocks.getDashboardData.mockResolvedValue({
      publications: [{ id: "p1", organization_id: organization.id, customer_id: "c1", title: "Fixture post", url: "https://nextdoor.com/p/abc", account_label: "Fixture profile", published_at: observed, source: "sheet_import", created_at: observed, visibility: "live", last_observed_at: observed, comments_total: null, recorded_session_id: null }],
      customers: [{ id: "c1", organization_id: organization.id, name: "ND Test", time_zone: "America/Los_Angeles", service: null, created_at: observed }],
      comments: [{ id: "m1", publication_id: "p1", body: "Fixture comment body", author_label: "Fixture author", platform_created_at: null, first_observed_at: observed, source_comment_id: null }],
      session: null, truncated: false,
    });
    const home = renderToStaticMarkup(await Home());
    expect(home).toContain("Last 24 hours by profile");
    expect(home).toContain("Fixture profile");
    expect(home).not.toContain("Fixture comment body");
    expect(home).toContain("dashboard/responses?profile=Fixture%20profile");

    // The inbox reads Incogniton profile names straight from the inventory table.
    const inventoryQuery = { select: () => inventoryQuery, eq: () => inventoryQuery, limit: async () => ({ data: [{ profile_id: "uuid-fixture", name: "ND 001" }], error: null }) };
    mocks.requireWorkspace.mockResolvedValue({ organization, isStaff: true, db: { from: () => inventoryQuery } });
    mocks.getOperationsData.mockResolvedValue({ workers: [], bindings: [{ id: "b1", worker_id: "w1", customer_id: "c1", profile_id: "uuid-fixture", account_label: "Fixture profile", monitoring_session_id: null }], jobs: [], tasks: [], profiles: [], tasksLimited: false, automationAvailable: true, available: true, limited: false, loadedAt: Date.now() });
    const responses = renderToStaticMarkup(await Responses({ searchParams: Promise.resolve({}) }));
    expect(responses).toContain("Open these 1 profile(s)");
    expect(responses).toContain("ND 001");
    expect(responses).toContain("Fixture comment body");
    expect(responses).toContain("Fixture profile");
    expect(responses).toContain("Open thread");
    expect(responses).toContain("Not enabled in the dashboard yet");
  });
});
