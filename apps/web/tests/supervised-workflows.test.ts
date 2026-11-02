import { beforeEach, describe, expect, it, vi } from "vitest";
import { workflowManifest, workflowResult } from "@/lib/supervised-workflows";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), rpc: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { enqueueSupervisedWorkflow } from "@/app/actions/supervised-workflows";
const org = "11111111-1111-4111-8111-111111111111", request = "22222222-2222-4222-8222-222222222222";
const manifest = { version: 1, operation: "account_inspect", binding_id: org, profile_id: org, customer_id: org, account_label: "Authorized fixture",
  account_url: "https://nextdoor.com/profile/fixture", target_url: null, expected_body_sha256: null, draft_id: null, draft_revision: null, consent: true };
function form(value: unknown = manifest) {
  const data = new FormData(); data.set("requestId", request); data.set("manifest", JSON.stringify(value)); data.set("confirmed", "on"); return data;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.workspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: org } });
  mocks.rpc.mockImplementation((name: string) => ({ abortSignal: () => Promise.resolve({ data: name === "reporting_supervised_workflow_version" ? 1 : request, error: null }) }));
});
describe("strict non-secret workflow contracts", () => {
  it("supports exact one-operation account access and genuine-data registration manifests", () => {
    expect(workflowManifest.safeParse(manifest).success).toBe(true);
    expect(workflowManifest.safeParse({ ...manifest, operation: "account_register", account_url: null }).success).toBe(true);
  });
  it.each([{ password: "PRIVATE" }, { consent: false }, { operation: "mass_block" }, { account_url: "https://evil.invalid/profile/x" }, { target_url: "unexpected" },
    { operation: "account_register" }, { draft_revision: 2 }, { operation: "post_edit", target_url: "https://nextdoor.com/p/fixture", expected_body_sha256: "a".repeat(64) },
    { operation: "account_block", target_url: manifest.account_url }])("refuses malformed/secret manifests %#", (change) => {
    expect(workflowManifest.safeParse({ ...manifest, ...change }).success).toBe(false);
  });
  it("result schema rejects raw data and truthy-string outcome flags", () => {
    const receipt = { operation: "account_inspect", outcome: "verified", action_attempted: false, cleanup_confirmed: true, adapter_sha256: "f".repeat(64), observed_at: new Date().toISOString() };
    expect(workflowResult.safeParse(receipt).success).toBe(true);
    expect(workflowResult.safeParse({ ...receipt, password: "PRIVATE" }).success).toBe(false);
    expect(workflowResult.safeParse({ ...receipt, action_attempted: "false" }).success).toBe(false);
  });
});
describe("authorized server action", () => {
  it("uses stale-tab guard and server workspace, not a client-supplied organization", async () => {
    const value = form(); value.set("organization_id", "forged");
    expect((await enqueueSupervisedWorkflow({}, value)).success).toContain(request);
    expect(mocks.workspace).toHaveBeenCalledWith(true, value);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "reporting_enqueue_supervised_workflow", { org, request_id: request, manifest, destructive_confirmed: false });
  });
  it("requires separate destructive-target confirmation before any RPC", async () => {
    const value = form({ ...manifest, operation: "post_delete", target_url: "https://nextdoor.com/p/fixture", expected_body_sha256: "a".repeat(64) });
    expect((await enqueueSupervisedWorkflow({}, value)).error).toContain("destructive target"); expect(mocks.rpc).not.toHaveBeenCalled();
    value.set("destructive", "on"); expect((await enqueueSupervisedWorkflow({}, value)).success).toBeTruthy();
  });
  it.each(["duplicate", "confirmation", "json", "size", "secret"])("rejects invalid %s before RPC", async (kind) => {
    const value = form();
    if (kind === "duplicate") value.append("requestId", request);
    if (kind === "confirmation") value.delete("confirmed");
    if (kind === "json") value.set("manifest", "PRIVATE_INVALID");
    if (kind === "size") value.set("manifest", "x".repeat(5001));
    if (kind === "secret") value.set("manifest", JSON.stringify({ ...manifest, password: "PRIVATE" }));
    expect((await enqueueSupervisedWorkflow({}, value)).error).toBeTruthy(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed without reviewed schema", async () => {
    mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ error: { message: "PRIVATE" } }) });
    expect((await enqueueSupervisedWorkflow({}, form())).error).toContain("migration is not available"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("preserves uncertain outcomes and never exposes provider response bodies", async () => {
    mocks.rpc.mockImplementation((name: string) => ({ abortSignal: () => name === "reporting_supervised_workflow_version" ? Promise.resolve({ data: 1 }) : Promise.reject(new Error("PRIVATE_ERROR")) }));
    const value = await enqueueSupervisedWorkflow({}, form()); expect(value.error).toContain("unconfirmed"); expect(value.error).not.toContain("PRIVATE");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
