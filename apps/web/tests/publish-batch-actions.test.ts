import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { enqueueScheduledPublishBatch } from "@/app/actions/publishing";
const org = "11111111-1111-4111-8111-111111111111", draftId = "22222222-2222-4222-8222-222222222222", jobId = "33333333-3333-4333-8333-333333333333";
const request = "44444444-4444-4444-8444-444444444444";
function form() {
  const value = new FormData(); value.set("requestId", request); value.set("confirmed", "on");
  value.set("entries", JSON.stringify([{ draftId, revision: 2, localTime: "", windowMinutes: 10 }])); return value;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ organization: { id: org, time_zone: "America/Los_Angeles" }, db: { rpc: mocks.rpc } });
  mocks.rpc.mockImplementation((name) => ({ abortSignal: () => Promise.resolve(name === "reporting_publish_scheduling_version" ? { data: 1, error: null } :
    { data: [{ jobId, draftId, revision: 2, notBefore: "2026-11-02T17:00:00Z", dispatchUntil: "2026-11-02T17:10:00Z" }], error: null }) }));
});
it("uses the server-authorized workspace/timezone and never invokes a browser RPC", async () => {
  const value = form(); value.set("organizationId", "forged"); value.set("timeZone", "UTC");
  const result = await enqueueScheduledPublishBatch({}, value);
  expect(mocks.requireWorkspace).toHaveBeenCalledWith(true, value);
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "reporting_enqueue_publish_batch", { org, request_id: request, entries: [{ draftId, revision: 2, windowMinutes: 10, notBefore: null }] });
  expect(result.success).toContain("Nothing was submitted by this browser action");
});
it.each(["confirmation", "request", "json", "duplicate", "size"])("rejects invalid %s before RPC", async (kind) => {
  const value = form();
  if (kind === "confirmation") value.delete("confirmed");
  if (kind === "request") value.set("requestId", "invalid");
  if (kind === "json") value.set("entries", "PRIVATE_INVALID");
  if (kind === "duplicate") { const rows = JSON.parse(value.get("entries") as string); value.set("entries", JSON.stringify([...rows, ...rows])); }
  if (kind === "size") value.set("entries", "x".repeat(32769));
  expect((await enqueueScheduledPublishBatch({}, value)).error).toBeTruthy(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("fails closed when the scheduling migration is absent", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: null, error: { code: "42883" } }) });
  expect((await enqueueScheduledPublishBatch({}, form())).error).toContain("migration is not available"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("preserves unconfirmed outcomes without leaking server/transport bodies", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.reject(new Error("PRIVATE_TRANSPORT")) });
  const result = await enqueueScheduledPublishBatch({}, form()); expect(result.error).toContain("unconfirmed"); expect(result.error).not.toContain("PRIVATE");
});
it("rejects unrelated or incomplete receipts and does not advertise a new request", async () => {
  mocks.rpc.mockImplementation((name) => ({ abortSignal: () => Promise.resolve(name === "reporting_publish_scheduling_version" ? { data: 1, error: null } : { data: [{ jobId, draftId: jobId, revision: 2, notBefore: "2026-11-02T17:00:00Z", dispatchUntil: "2026-11-02T17:10:00Z" }], error: null }) }));
  expect((await enqueueScheduledPublishBatch({}, form())).error).toContain("receipt could not be verified");
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
