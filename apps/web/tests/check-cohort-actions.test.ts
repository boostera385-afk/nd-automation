import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), rpc: vi.fn(), abort: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { refreshCheckCohort } from "@/app/actions/check-cohort";
const org = "11111111-1111-4111-8111-111111111111", customer = "22222222-2222-4222-8222-222222222222", requestId = "33333333-3333-4333-8333-333333333333";
const receipt = { version: 1, policyVersion: 1, organizationId: org, cohortId: requestId, requestId, customerId: customer, day: "2026-10-28", kind: "posts", timeZone: "America/Los_Angeles", freshnessMinutes: 60, total: 1, unknownDates: 0, queued: 1, active: 0, recent: 0, blocked: 0 };
const form = () => { const value = new FormData(); for (const [key, text] of Object.entries({ customer, requestId, day: receipt.day, kind: "posts", freshness: "60", confirmed: "on" })) value.set(key, text); return value; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.workspace.mockResolvedValue({ organization: { id: org }, db: { rpc: mocks.rpc } });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abort }); mocks.abort.mockResolvedValue({ data: receipt, error: null });
});
it("uses selected-business authorization, stable request and bounded server RPC only", async () => {
  const input = form(); input.set("org", "forged");
  expect((await refreshCheckCohort({}, input)).receipt).toEqual(receipt);
  expect(mocks.workspace).toHaveBeenCalledWith(true, input);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reporting_refresh_check_cohort_v1", { org, customer, day: receipt.day, kind: "posts", freshness_minutes: 60, request_id: requestId });
  expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("propagates stale-workspace or unconfirmed denial before dispatch", async () => {
  mocks.workspace.mockRejectedValue(new Error("redirect:/verify-email"));
  await expect(refreshCheckCohort({}, form())).rejects.toThrow("redirect:/verify-email"); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["customer", "day", "kind", "freshness", "requestId", "confirmed"])("refuses missing or duplicate %s fields", async (key) => {
  const missing = form(); missing.delete(key); expect((await refreshCheckCohort({}, missing)).error).toBeTruthy();
  const duplicate = form(); duplicate.append(key, "forged"); expect((await refreshCheckCohort({}, duplicate)).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([{ day: "2026-02-30" }, { kind: "arbitrary" }, { freshness: "0" }, { requestId: "new-random-text" }])("refuses malformed fields before RPC (%o)", async (changes) => {
  const input = form(); for (const [key, value] of Object.entries(changes)) input.set(key, value);
  expect((await refreshCheckCohort({}, input)).error).toBeTruthy(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("labels missing protocol setup, never success", async () => {
  mocks.abort.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  expect((await refreshCheckCohort({}, form())).error).toContain("not deployed");
});
it.each(["organizationId", "requestId", "customerId", "day", "kind", "freshnessMinutes"])("rejects a mismatched %s receipt", async (key) => {
  mocks.abort.mockResolvedValue({ data: { ...receipt, [key]: key === "freshnessMinutes" ? 120 : key === "day" ? "2026-10-27" : key === "kind" ? "both" : "44444444-4444-4444-8444-444444444444" }, error: null });
  expect((await refreshCheckCohort({}, form())).error).toContain("receipt could not be verified"); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("does not automatically retry or echo raw failures", async () => {
  mocks.abort.mockRejectedValue(new Error("PRIVATE_TOKEN_DO_NOT_ECHO"));
  const result = await refreshCheckCohort({}, form());
  expect(result.error).toContain("unconfirmed"); expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN"); expect(mocks.rpc).toHaveBeenCalledOnce();
});
