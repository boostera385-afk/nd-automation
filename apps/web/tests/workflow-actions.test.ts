import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), getOperationsData: vi.fn(), fetchSheetRows: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("@/lib/operations-data", () => ({ getOperationsData: mocks.getOperationsData }));
vi.mock("@/lib/sheet-sync", () => ({ fetchSheetRows: mocks.fetchSheetRows, SheetSyncError: Error }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setBatchMonitoring, syncMappedPosts } from "@/app/actions/workflow";

const binding = { id: "11111111-1111-4111-8111-111111111111", worker_id: "22222222-2222-4222-8222-222222222222", customer_id: "33333333-3333-4333-8333-333333333333", profile_id: "44444444-4444-4444-8444-444444444444", account_label: "Exact profile", monitoring_session_id: null };
const other = { ...binding, id: "55555555-5555-4555-8555-555555555555", account_label: "Second profile" };
const row = { rowNumber: 2, profileName: binding.account_label, title: "Source content", postLink: "https://nextdoor.com/p/known", status: "Posted" };
const operations = { available: true, bindingsLimited: false, bindings: [binding, other], workers: [{ id: binding.worker_id, enabled: true }] };
const syncForm = () => { const form = new FormData(); form.set("sheet", "Auto Posting"); return form; };
const batchForm = (ids = [binding.id], mode = "enable") => { const form = new FormData(); ids.forEach((id) => form.append("binding", id)); form.set("mode", mode); form.set("confirmed", "on"); return form; };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ organization: { id: "org" }, db: { rpc: mocks.rpc } });
  mocks.getOperationsData.mockResolvedValue(operations);
  mocks.fetchSheetRows.mockResolvedValue({ rows: [row], fetchedAt: "2026-10-27T12:00:00Z", truncated: false });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});

describe("mapped Sheet synchronization", () => {
  it("requires staff and uses server-read rows / saved mappings, not submitted records or customers", async () => {
    const form = syncForm(); form.set("records", "forged"); form.set("customer", "forged-customer");
    expect((await syncMappedPosts({}, form)).success).toContain("1 new links");
    expect(mocks.requireWorkspace).toHaveBeenCalledWith(true);
    expect(mocks.rpc).toHaveBeenCalledWith("reporting_add_publications", { org: "org", customer: binding.customer_id, record_source: "sheet_import", records: [expect.objectContaining({ account_label: binding.account_label, published_at: null })] });
  });
  it("cannot publish, change the Sheet or call arbitrary RPCs", async () => {
    await syncMappedPosts({}, syncForm());
    expect(mocks.rpc.mock.calls.every(([name]) => name === "reporting_add_publications")).toBe(true);
    const form = syncForm(); form.set("sheet", "ND Acc Creation");
    expect((await syncMappedPosts({}, form)).error).toContain("posting or listing");
  });
  it("skips unmapped profiles rather than requiring per-row forms or inventing customers", async () => {
    mocks.getOperationsData.mockResolvedValue({ ...operations, bindings: [] });
    expect((await syncMappedPosts({}, syncForm())).success).toContain("1 need a profile/customer mapping");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses incomplete mappings and handles source failures without writes", async () => {
    mocks.getOperationsData.mockResolvedValue({ ...operations, bindingsLimited: true });
    expect((await syncMappedPosts({}, syncForm())).error).toContain("incomplete");
    expect(mocks.fetchSheetRows).not.toHaveBeenCalled();
    mocks.getOperationsData.mockResolvedValue(operations);
    mocks.fetchSheetRows.mockRejectedValue(new Error("Connection unavailable"));
    expect((await syncMappedPosts({}, syncForm())).error).toBe("Connection unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("chunks at 100 and reports partial completion on a later failure", async () => {
    mocks.fetchSheetRows.mockResolvedValue({ rows: Array.from({ length: 101 }, (_, i) => ({ ...row, rowNumber: i + 2, postLink: `https://nextdoor.com/p/p${i}` })), truncated: false });
    mocks.rpc.mockResolvedValueOnce({ data: 100, error: null }).mockResolvedValueOnce({ data: null, error: { code: "failed" } });
    expect((await syncMappedPosts({}, syncForm())).error).toContain("after 100 new links");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][1].records).toHaveLength(100);
  });
  it("reports duplicates and partial sources honestly", async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    mocks.fetchSheetRows.mockResolvedValue({ rows: [row], truncated: true });
    const result = await syncMappedPosts({}, syncForm());
    expect(result.success).toContain("1 already recorded"); expect(result.success).toContain("Partial source");
  });
  it("does not manufacture counts from an invalid RPC result", async () => {
    mocks.rpc.mockResolvedValue({ data: "unexpected", error: null });
    expect((await syncMappedPosts({}, syncForm())).error).toContain("may already be saved");
  });
});

describe("explicit batch monitoring", () => {
  it("uses one explicit confirmation for a saved, scoped group", async () => {
    expect((await setBatchMonitoring({}, batchForm([binding.id, other.id]))).success).toContain("2 profiles");
    expect(mocks.requireWorkspace).toHaveBeenCalledWith(true);
    expect(mocks.rpc.mock.calls).toEqual([
      ["reporting_set_profile_monitoring", { org: "org", binding: binding.id, enabled: true }],
      ["reporting_set_profile_monitoring", { org: "org", binding: other.id, enabled: true }],
    ]);
  });
  it("deduplicates IDs and validates all assignments before changing any", async () => {
    await setBatchMonitoring({}, batchForm([binding.id, binding.id]));
    expect(mocks.rpc).toHaveBeenCalledTimes(1); mocks.rpc.mockClear();
    const result = await setBatchMonitoring({}, batchForm([binding.id, "66666666-6666-4666-8666-666666666666"]));
    expect(result.error).toContain("no longer available"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects unconfirmed, oversized and unsupported batches before writes", async () => {
    const unconfirmed = batchForm(); unconfirmed.delete("confirmed");
    for (const form of [unconfirmed, batchForm(Array(101).fill(binding.id)), batchForm([binding.id], "publish")]) expect((await setBatchMonitoring({}, form)).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects enablement of disabled workers but permits disabling checks", async () => {
    mocks.getOperationsData.mockResolvedValue({ ...operations, workers: [{ id: binding.worker_id, enabled: false }] });
    expect((await setBatchMonitoring({}, batchForm())).error).toContain("No profiles were enabled");
    expect(mocks.rpc).not.toHaveBeenCalled();
    await setBatchMonitoring({}, batchForm([binding.id], "disable"));
    expect(mocks.rpc).toHaveBeenCalledWith("reporting_set_profile_monitoring", { org: "org", binding: binding.id, enabled: false });
  });
  it("reports partial batch updates and never claims transactional all-or-nothing behavior", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: "session_closed" } });
    expect((await setBatchMonitoring({}, batchForm([binding.id, other.id]))).error).toContain("Updated 1 profiles, then stopped");
  });
  it("does not read data or mutate anything when the verified staff gate rejects access", async () => {
    mocks.requireWorkspace.mockRejectedValue(new Error("Not authorized"));
    await expect(setBatchMonitoring({}, batchForm())).rejects.toThrow("Not authorized");
    await expect(syncMappedPosts({}, syncForm())).rejects.toThrow("Not authorized");
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.getOperationsData).not.toHaveBeenCalled();
  });
});
