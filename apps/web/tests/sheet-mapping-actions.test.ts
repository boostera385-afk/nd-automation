import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { setPublicationSheetMapping, setPublishSheetTarget } from "@/app/actions/sheet-writeback";
const org = "11111111-1111-4111-8111-111111111111", publication = "22222222-2222-4222-8222-222222222222", row = "33333333-3333-4333-8333-333333333333";
function mapping() {
  const form = new FormData(); for (const [key, value] of Object.entries({ publication, tab: "Auto Posting", row, revision: "1", enabled: "true", confirmed: "on" })) form.set(key, value); return form;
}
function target() {
  const form = new FormData(); for (const [key, value] of Object.entries({ binding: publication, enabled: "true", checks: "true", confirmed: "on" })) form.set(key, value); return form;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.requireWorkspace.mockResolvedValue({ organization: { id: org }, db: { rpc: mocks.rpc } });
  mocks.rpc.mockImplementation((name) => ({ abortSignal: () => Promise.resolve({ data: name === "reporting_sheet_mapping_version" ? 1 : null, error: null }) }));
});
it("binds exact stable mapping to the verified server workspace and checks the deployed protocol", async () => {
  const form = mapping(); form.set("organizationId", "forged");
  const result = await setPublicationSheetMapping({}, form);
  expect(mocks.requireWorkspace).toHaveBeenCalledWith(true, form);
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "reporting_set_publication_sheet_mapping", { org, publication, tab_name: "Auto Posting", stable_row: row, expected_revision: 1, enabled: true });
  expect(result.success).toContain("no historical replay");
});
it("makes future publication/check opt-in explicit without changing existing mappings", async () => {
  const result = await setPublishSheetTarget({}, target());
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "reporting_set_publish_sheet_target", { org, binding: publication, enabled: true, include_checks: true });
  expect(result.success).toContain("already queued writes are unchanged");
});
it.each(["confirmation", "id", "revision", "tab", "enabled"])("rejects invalid %s before any RPC", async (kind) => {
  const form = mapping();
  if (kind === "confirmation") form.delete("confirmed");
  if (kind === "id") form.set("row", "A2");
  if (kind === "revision") form.set("revision", "0");
  if (kind === "tab") form.set("tab", "Credentials");
  if (kind === "enabled") form.set("enabled", "yes");
  expect((await setPublicationSheetMapping({}, form)).error).toBeTruthy(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("fails closed on missing schema and redacts transport/provider errors", async () => {
  mocks.rpc.mockReturnValueOnce({ abortSignal: () => Promise.resolve({ error: { message: "PRIVATE" }, data: null }) });
  expect((await setPublicationSheetMapping({}, mapping())).error).toContain("migration is not available");
  mocks.rpc.mockReturnValueOnce({ abortSignal: () => Promise.reject(new Error("PRIVATE_ERROR")) });
  const result = await setPublishSheetTarget({}, target()); expect(result.error).toContain("unconfirmed"); expect(result.error).not.toContain("PRIVATE");
});
