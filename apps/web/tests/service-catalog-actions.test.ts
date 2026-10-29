import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { stageServiceCatalog } from "@/app/actions/service-catalog";
const org = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222", revisionId = "33333333-3333-4333-8333-333333333333";
const rule = { keyword: "Fixture service", searchTerm: "fixture", family: "Fixtures", subcategory: "Fixture", businessSignals: [], reviewSignals: [], requiredSignals: [], topicSignals: [], excludeSignals: [], topicRequired: false, collectFamilyInventory: true, rewriteServicePhrase: "", equivalentServicePhrases: [] };
function form() {
  const data = new FormData(); data.set("rules", JSON.stringify([rule])); data.set("requestId", requestId);
  data.set("expectedRevision", "0"); data.set("confirmed", "on"); return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: org }, user: { email_confirmed_at: "2026-10-29T00:00:00Z" } });
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { revisionId, revision: 1 }, error: null }) });
});
it("requires staff and current verified email before requesting a save", async () => {
  mocks.requireWorkspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: org }, user: {} });
  expect((await stageServiceCatalog({}, form())).error).toContain("Verify your email");
  expect(mocks.requireWorkspace).toHaveBeenCalledWith(true); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("binds save to server-authorized business, replay ID and base version without activation", async () => {
  const data = form(); data.set("organizationId", "forged-business");
  expect((await stageServiceCatalog({}, data)).success).toContain("Nothing was activated");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reporting_save_service_catalog_v1", { org, rules: [rule], expected_revision: 0, request_id: requestId });
  expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/settings/services");
});
it.each(["confirmation", "json", "fields", "request", "size"])("rejects invalid %s before a database request", async (kind) => {
  const data = form();
  if (kind === "confirmation") data.delete("confirmed");
  if (kind === "json") data.set("rules", "PRIVATE_INVALID_JSON");
  if (kind === "fields") data.set("rules", JSON.stringify([{ ...rule, injected: "PRIVATE_INVALID_DATA" }]));
  if (kind === "request") data.set("requestId", "invalid");
  if (kind === "size") data.set("rules", "x".repeat(262145));
  const result = await stageServiceCatalog({}, data);
  expect(result.error).toBeTruthy(); expect(JSON.stringify(result)).not.toContain("PRIVATE_INVALID");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("reports expected-version conflicts without leaking server bodies", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ error: { message: "Catalog version conflict PRIVATE_SERVER_BODY" } }) });
  const result = await stageServiceCatalog({}, form());
  expect(result.error).toContain("Reload and review"); expect(result.error).not.toContain("PRIVATE_SERVER_BODY");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("treats a write timeout as unconfirmed, never a safe automatic repeat", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.reject(new Error("PRIVATE_TRANSPORT_BODY")) });
  const result = await stageServiceCatalog({}, form());
  expect(result.error).toContain("outcome is unconfirmed"); expect(result.error).not.toContain("PRIVATE_TRANSPORT_BODY");
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("refuses inconsistent receipts rather than claiming a successful save", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { revisionId, revision: 99 }, error: null }) });
  expect((await stageServiceCatalog({}, form())).error).toContain("receipt could not be verified");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
