import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { enqueueApprovedPublish } from "@/app/actions/publishing";

const org = "11111111-1111-4111-8111-111111111111";
const draft = "44444444-4444-4444-8444-444444444444";
function form(confirmed = true) {
  const value = new FormData();
  value.set("draft", draft); value.set("expected_revision", "2"); value.set("workspaceContext", "fixture-context");
  if (confirmed) value.set("confirmed", "on");
  return value;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ organization: { id: org }, db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});

describe("explicit approved-revision publishing authorization", () => {
  it("requires verified staff/workspace context and explicit confirmation before any RPC", async () => {
    const value = form(false);
    expect((await enqueueApprovedPublish({}, value)).error).toMatch(/Confirm/);
    expect(mocks.requireWorkspace).toHaveBeenCalledWith(true, value);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects bad revisions and IDs without network mutations", async () => {
    for (const revision of ["0", "1.5", "-1", "not-a-revision"]) {
      const value = form(); value.set("expected_revision", revision);
      expect((await enqueueApprovedPublish({}, value)).error).toBeTruthy();
    }
    const value = form(); value.set("draft", "wrong");
    expect((await enqueueApprovedPublish({}, value)).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed when the cross-type safety migration is missing or the version is unknown", async () => {
    for (const response of [{ data: null, error: { code: "42883" } }, { data: 2, error: null }]) {
      mocks.rpc.mockResolvedValueOnce(response);
      expect((await enqueueApprovedPublish({}, form())).error).toMatch(/safety migration/);
    }
    expect(mocks.rpc.mock.calls.every(([method]) => method === "reporting_publisher_protocol_version")).toBe(true);
  });
  it("queues only the exact approved identity and reports no browser submission", async () => {
    const result = await enqueueApprovedPublish({}, form());
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "reporting_enqueue_publish", { org, draft, expected_revision: 2 });
    expect(result.success).toContain("Nothing was submitted by this browser action");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/dashboard/content/${draft}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/publishing");
  });
  it("does not leak server details or advertise retries for duplicate/ambiguous jobs", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ data: null, error: { message: "PRIVATE server details" } });
    const result = await enqueueApprovedPublish({}, form());
    expect(result.error).toContain("Never requeue submitted or ambiguous work");
    expect(result.error).not.toContain("PRIVATE");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("never calls a worker RPC when workspace/auth verification fails", async () => {
    mocks.requireWorkspace.mockRejectedValue(new Error("stale workspace"));
    await expect(enqueueApprovedPublish({}, form())).rejects.toThrow("stale workspace");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
