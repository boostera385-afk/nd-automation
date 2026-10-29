import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), from: vi.fn(), rpc: vi.fn(), abort: vi.fn(), eq: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace }));
import { loadCohortHistory, loadCohortReport } from "@/lib/cohort-data";
const org = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const receipt = { version: 1, policyVersion: 1, organizationId: org, cohortId: id, requestId: id, customerId: id, day: "2026-10-28", kind: "posts", timeZone: "America/Los_Angeles", freshnessMinutes: 60, total: 0, unknownDates: 0, queued: 0, active: 0, recent: 0, blocked: 0 };
const row = { id, organization_id: org, receipt, created_at: "2026-10-29T12:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.workspace.mockResolvedValue({ organization: { id: org }, db: { from: mocks.from, rpc: mocks.rpc } });
  const chain = { select: vi.fn(() => chain), eq: mocks.eq, order: vi.fn(() => chain), limit: vi.fn(() => chain), abortSignal: mocks.abort };
  mocks.eq.mockReturnValue(chain); mocks.from.mockReturnValue(chain); mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
  mocks.abort.mockResolvedValue({ data: [row], error: null });
});
it("loads at most 20 scoped exact receipts with a deadline", async () => {
  expect(await loadCohortHistory()).toMatchObject({ available: true, rows: [row] });
  expect(mocks.workspace).toHaveBeenCalledWith(true); expect(mocks.eq).toHaveBeenCalledWith("organization_id", org);
  expect(mocks.from.mock.results[0].value.limit).toHaveBeenCalledWith(20);
  expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("distinguishes unapplied setup from ordinary unavailable history", async () => {
  mocks.abort.mockResolvedValue({ data: null, error: { code: "42P01" } });
  expect(await loadCohortHistory()).toMatchObject({ available: false, setup: true });
  mocks.abort.mockResolvedValue({ data: [], error: { code: "42501" } });
  expect(await loadCohortHistory()).toMatchObject({ available: false, setup: false });
});
it.each([null, [row, row], [{ ...row, organization_id: id }], [{ ...row, receipt: { ...receipt, organizationId: id } }], Array(21).fill(row)])("rejects malformed, mismatched, duplicate or oversized history", async (data) => {
  mocks.abort.mockResolvedValue({ data, error: null }); expect((await loadCohortHistory()).available).toBe(false);
});
it("accepts a strict detail snapshot and never accepts another business or cohort", async () => {
  const report = { receipt, createdAt: row.created_at, items: [] };
  mocks.abort.mockResolvedValue({ data: report, error: null });
  expect(await loadCohortReport(id)).toEqual({ available: true, report });
  expect(mocks.rpc).toHaveBeenCalledWith("reporting_get_check_cohort_v1", { org, cohort_id: id });
  mocks.abort.mockResolvedValue({ data: { ...report, receipt: { ...receipt, organizationId: id } }, error: null });
  expect((await loadCohortReport(id)).available).toBe(false);
});
it("treats not-found separately from transport failure without echoing bodies", async () => {
  mocks.abort.mockResolvedValue({ data: null, error: null }); expect(await loadCohortReport(id)).toEqual({ available: true, report: null });
  mocks.abort.mockRejectedValue(new Error("PRIVATE_BODY_DO_NOT_ECHO"));
  expect(await loadCohortReport(id)).toEqual({ available: false, report: null });
  expect((await loadCohortHistory()).available).toBe(false);
});
it("rejects malformed IDs and central authorization before data reads", async () => {
  expect(await loadCohortReport("invalid")).toEqual({ available: true, report: null }); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.workspace.mockRejectedValue(new Error("redirect:/verify-email"));
  await expect(loadCohortHistory()).rejects.toThrow("redirect:/verify-email");
  await expect(loadCohortReport(id)).rejects.toThrow("redirect:/verify-email"); expect(mocks.from).not.toHaveBeenCalled();
});
