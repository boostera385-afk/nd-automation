import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { stageServiceCatalog, activateServiceCatalog } from "@/app/actions/service-catalog";
const org = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222", revisionId = "33333333-3333-4333-8333-333333333333";
const rule = { keyword: "Fixture service", searchTerm: "fixture", family: "Fixtures", subcategory: "Fixture", businessSignals: [], reviewSignals: [], requiredSignals: [], topicSignals: [], excludeSignals: [], topicRequired: false, collectFamilyInventory: true, rewriteServicePhrase: "", equivalentServicePhrases: [] };
function form() {
  const data = new FormData(); data.set("rules", JSON.stringify([rule])); data.set("requestId", requestId);
  data.set("expectedRevision", "0"); data.set("confirmed", "on"); return data;
}
function activationForm() {
  const data = new FormData(); data.set("revisionId", revisionId); data.set("requestId", requestId);
  data.set("expectedVersion", "0"); data.set("confirmed", "on"); return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: org }, user: { email_confirmed_at: "2026-10-29T00:00:00Z" }, membership: { role: "owner" } });
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
it("restricts activation to a verified owner or admin before any backend request", async () => {
  mocks.requireWorkspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: org }, user: { email_confirmed_at: "2026-10-29T00:00:00Z" }, membership: { role: "operator" } });
  expect((await activateServiceCatalog({}, activationForm())).error).toContain("owner or admin");
  mocks.requireWorkspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: org }, user: {}, membership: { role: "owner" } });
  expect((await activateServiceCatalog({}, activationForm())).error).toContain("owner or admin");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("activates the exact reviewed revision against bounded base version and replay ID only", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { revisionId, generation: 1 }, error: null }) });
  const data = activationForm(); data.set("organizationId", "forged-business");
  const result = await activateServiceCatalog({}, data);
  expect(result.success).toContain("no collection or publishing job started");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reporting_activate_service_catalog_v1", { org, revision_id: revisionId, expected_version: 0, request_id: requestId });
  expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/settings/services", "layout");
});
it.each(["confirmation", "revision", "request", "version"])("rejects malformed activation %s before a database request", async (kind) => {
  const data = activationForm();
  if (kind === "confirmation") data.delete("confirmed");
  if (kind === "revision") data.set("revisionId", "invalid");
  if (kind === "request") data.set("requestId", "invalid");
  if (kind === "version") data.set("expectedVersion", "-1");
  expect((await activateServiceCatalog({}, data)).error).toContain("Review the exact revision");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("reports activation version conflicts without leaking server bodies or retrying", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ error: { message: "Activation version conflict PRIVATE_SERVER_BODY" } }) });
  const result = await activateServiceCatalog({}, activationForm());
  expect(result.error).toContain("Reload the comparison"); expect(result.error).not.toContain("PRIVATE_SERVER_BODY");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("treats an activation timeout as unconfirmed, never a proven failure or automatic repeat", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.reject(new Error("PRIVATE_TRANSPORT_BODY")) });
  const result = await activateServiceCatalog({}, activationForm());
  expect(result.error).toContain("outcome is unconfirmed"); expect(result.error).not.toContain("PRIVATE_TRANSPORT_BODY");
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("refuses mismatched activation receipts instead of claiming publication", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { revisionId: "44444444-4444-4444-8444-444444444444", generation: 1 }, error: null }) });
  expect((await activateServiceCatalog({}, activationForm())).error).toContain("Activation receipt could not be verified");
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: { revisionId, generation: 7 }, error: null }) });
  expect((await activateServiceCatalog({}, activationForm())).error).toContain("Activation receipt could not be verified");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
