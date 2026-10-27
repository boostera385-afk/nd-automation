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

import Home from "@/app/dashboard/page";
import RunAutomation from "@/app/dashboard/run/page";
import { Navigation } from "@/components/navigation";

const organization = { id: "11111111-1111-4111-8111-111111111111", name: "Fixture workspace", time_zone: "America/Los_Angeles" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.path = "/dashboard";
  mocks.getContext.mockResolvedValue({ organization, isStaff: true });
  mocks.requireWorkspace.mockResolvedValue({ organization, isStaff: true });
  mocks.getDashboardData.mockResolvedValue({ publications: [], customers: [], comments: [], session: null, truncated: false });
  mocks.getOperationsData.mockResolvedValue({ workers: [], bindings: [], jobs: [], available: true, limited: false, loadedAt: Date.parse("2026-10-27T12:00:00Z") });
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
    expect(html).toContain("still run in your desktop app");
  });
  it("renders customer home without loading any operations data", async () => {
    mocks.getContext.mockResolvedValue({ organization, isStaff: false });
    const html = renderToStaticMarkup(await Home());
    expect(mocks.getOperationsData).not.toHaveBeenCalled();
    expect(html).not.toContain("LOCAL LAPTOP"); expect(html).toContain("View results");
  });
  it("labels unsupported desktop tasks rather than offering pretend Start buttons", async () => {
    const html = renderToStaticMarkup(await RunAutomation());
    expect((html.match(/Desktop only/g) ?? []).length).toBe(6);
    expect(html).not.toContain("Start posting"); expect(html).not.toContain("Create accounts now");
    expect(html).toContain("Post checks &amp; comments");
  });
});
