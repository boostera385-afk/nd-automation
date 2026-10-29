import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { cancelPendingSheetWriteback, enqueueSheetWriteback } from "@/app/actions/sheet-writeback";
const org = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222", itemId = "33333333-3333-4333-8333-333333333333";
const stable = "web-44444444-4444-4444-8444-444444444444";
const row = { "Profile Name": "Fixture profile", Status: "Filled" };
function form() {
  const data = new FormData();
  data.set("action", "append"); data.set("tab", "Auto Posting"); data.set("rows", JSON.stringify([row]));
  data.set("requestId", requestId); data.set("stableKey", stable); data.set("confirmed", "on");
  return data;
}
function updateForm() { const data = form(); data.set("action", "update_cells"); data.set("rowRef", "A2"); return data; }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: org }, user: { email_confirmed_at: "2026-10-29T00:00:00Z" }, membership: { role: "operator" } });
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { id: itemId, seq: 1, status: "pending" }, error: null }) });
});
it("requires staff and a verified email before any backend request", async () => {
  mocks.requireWorkspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: org }, user: {} });
  expect((await enqueueSheetWriteback({}, form())).error).toContain("Verify your email");
  expect((await cancelPendingSheetWriteback({}, cancelForm())).error).toContain("Verify your email");
  expect(mocks.requireWorkspace).toHaveBeenCalledWith(true, expect.any(FormData)); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("binds the intent to the server-authorized business, stable key and request only", async () => {
  const data = form(); data.set("organizationId", "forged-business");
  const result = await enqueueSheetWriteback({}, data);
  expect(result.success).toContain("nothing was written to any Sheet");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reporting_enqueue_sheet_writeback_v1", { org, intent: { action: "append", tab: "Auto Posting", rowRef: null, values: [row] }, stable_key: stable, request_id: requestId });
  expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/settings/sheet-writeback");
});
it("pins update_cells intents to the exact reviewed row reference", async () => {
  await enqueueSheetWriteback({}, updateForm());
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reporting_enqueue_sheet_writeback_v1", { org, intent: { action: "update_cells", tab: "Auto Posting", rowRef: "A2", values: [row] }, stable_key: stable, request_id: requestId });
});
it.each(["confirmation", "json", "cells", "request", "size", "rowref"])("rejects an invalid %s before any backend request", async (kind) => {
  const data = form();
  if (kind === "confirmation") data.delete("confirmed");
  if (kind === "json") data.set("rows", "PRIVATE_INVALID_JSON");
  if (kind === "cells") data.set("rows", JSON.stringify([{ "Profile Name": 17 }]));
  if (kind === "request") data.set("requestId", "invalid");
  if (kind === "size") data.set("rows", "x".repeat(262145));
  if (kind === "rowref") { const update = updateForm(); update.delete("rowRef"); const result = await enqueueSheetWriteback({}, update); expect(result.error).toContain("row reference"); expect(JSON.stringify(result)).not.toContain("PRIVATE_INVALID"); expect(mocks.rpc).not.toHaveBeenCalled(); return; }
  const result = await enqueueSheetWriteback({}, data);
  expect(result.error).toBeTruthy(); expect(JSON.stringify(result)).not.toContain("PRIVATE_INVALID"); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("reports replay conflicts without leaking server bodies", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ error: { message: "Writeback stable key conflict PRIVATE_SERVER_BODY" } }) });
  const result = await enqueueSheetWriteback({}, form());
  expect(result.error).toContain("already queued with different values");
  expect(result.error).not.toContain("PRIVATE_SERVER_BODY"); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("treats a queue-timeout as unconfirmed, never an automatic repeat", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.reject(new Error("PRIVATE_TRANSPORT_BODY")) });
  const result = await enqueueSheetWriteback({}, form());
  expect(result.error).toContain("outcome is unconfirmed"); expect(result.error).not.toContain("PRIVATE_TRANSPORT_BODY");
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("refuses inconsistent receipts rather than claiming a queued intent", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { id: itemId, seq: 1, status: "delivered" }, error: null }) });
  expect((await enqueueSheetWriteback({}, form())).error).toContain("receipt could not be verified");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
function cancelForm() {
  const data = new FormData(); data.set("itemId", itemId); data.set("requestId", requestId); data.set("confirmed", "on"); return data;
}
it("cancels only the exact confirmed pending item for the server-authorized business", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { id: itemId, status: "cancelled" }, error: null }) });
  const data = cancelForm(); data.set("organizationId", "forged-business");
  const result = await cancelPendingSheetWriteback({}, data);
  expect(result.success).toContain("No other intent was changed");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reporting_cancel_pending_sheet_writeback_v1", { org, item_id: itemId, request_id: requestId });
  expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/settings/sheet-writeback");
});
it.each(["item", "request", "confirmation"])("rejects malformed cancellation %s before any backend request", async (kind) => {
  const data = cancelForm();
  if (kind === "item") data.set("itemId", "not-a-uuid");
  if (kind === "request") data.set("requestId", "");
  if (kind === "confirmation") data.delete("confirmed");
  expect((await cancelPendingSheetWriteback({}, data)).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("maps non-pending cancellation refusals honestly", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ error: { message: "Only pending writeback can be cancelled" } }) });
  const result = await cancelPendingSheetWriteback({}, cancelForm());
  expect(result.error).toContain("Only still-pending intents"); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("refuses a cancellation receipt for any other item", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { id: "55555555-5555-4555-8555-555555555555", status: "cancelled" }, error: null }) });
  expect((await cancelPendingSheetWriteback({}, cancelForm())).error).toContain("receipt could not be verified");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
