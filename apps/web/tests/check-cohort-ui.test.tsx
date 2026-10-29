import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), data: vi.fn(), history: vi.fn(), report: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace, getDashboardData: mocks.data }));
vi.mock("@/lib/cohort-data", () => ({ loadCohortHistory: mocks.history, loadCohortReport: mocks.report }));
vi.mock("@/app/actions/check-cohort", () => ({ refreshCheckCohort: vi.fn() }));
import CheckCohorts from "@/app/dashboard/run/cohorts/page";
import CheckCohort from "@/app/dashboard/run/cohorts/[id]/page";
import { WorkspaceProvider } from "@/components/workspace-context";
const org = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const receipt = { version: 1, policyVersion: 1, organizationId: org, cohortId: id, requestId: id, customerId: id, day: "2026-10-28", kind: "posts", timeZone: "America/Los_Angeles", freshnessMinutes: 60, total: 0, unknownDates: 3, queued: 0, active: 0, recent: 0, blocked: 0 };
beforeEach(() => {
  vi.resetAllMocks(); mocks.workspace.mockResolvedValue({ organization: { id: org, time_zone: "America/Los_Angeles" } });
  mocks.data.mockResolvedValue({ customers: [{ id, name: "Fixture customer", time_zone: "America/Los_Angeles" }], session: { status: "active", started_at: new Date().toISOString() }, truncated: false });
  mocks.history.mockResolvedValue({ available: true, rows: [] });
  mocks.report.mockResolvedValue({ available: true, report: { receipt, createdAt: "2026-10-29T12:00:00Z", items: [] } });
});
it("renders a scoped explicit one-click form without automatic queueing or profile authorization", async () => {
  const scope = `${id}:${org}`;
  const html = renderToStaticMarkup(<WorkspaceProvider value={scope}>{await CheckCohorts()}</WorkspaceProvider>);
  expect(html).toContain('name="workspaceContext"'); expect(html).toContain(scope);
  expect(html).toContain("Refresh post statuses"); expect(html).toContain("Posts only"); expect(html).toContain("Both, explicitly");
  expect(html).toContain("No cohort requests are saved"); expect(html).toContain("Opening this page never queues checks");
  expect(html).toContain("Profiles must already be explicitly authorized");
});
it("disables mutation controls when setup or history is unverified", async () => {
  mocks.history.mockResolvedValue({ available: false, setup: true, rows: [] });
  let html = renderToStaticMarkup(await CheckCohorts()); expect(html).toContain("protocol setup is pending"); expect(html).not.toContain('name="confirmed"');
  mocks.history.mockResolvedValue({ available: false, setup: false, rows: [] });
  html = renderToStaticMarkup(await CheckCohorts()); expect(html).toContain("could not be verified"); expect(html).not.toContain('name="confirmed"');
});
it("requires complete customer data and an active session", async () => {
  mocks.data.mockResolvedValue({ customers: [], session: null, truncated: true });
  expect(renderToStaticMarkup(await CheckCohorts())).toContain("records are incomplete");
  mocks.data.mockResolvedValue({ customers: [{ id, name: "Fixture", time_zone: "UTC" }], session: null, truncated: false });
  const html = renderToStaticMarkup(await CheckCohorts()); expect(html).toContain("Start or resume work first"); expect(html).toContain('disabled=""');
});
it("renders immutable membership with unknown dates and no Sheet-delivery claim", async () => {
  const html = renderToStaticMarkup(await CheckCohort({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("3 unknown-date records were excluded"); expect(html).toContain("no Sheet delivery is active");
  expect(html).toContain("Missing links outside the ledger remain unknown");
});
it("fails closed on unavailable/missing detail instead of showing zero progress", async () => {
  mocks.report.mockResolvedValue({ available: false, report: null });
  expect(renderToStaticMarkup(await CheckCohort({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }))).toContain("Cohort unavailable");
  mocks.report.mockResolvedValue({ available: true, report: null });
  await expect(CheckCohort({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
});
