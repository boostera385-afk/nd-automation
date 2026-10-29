import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), from: vi.fn(), rpc: vi.fn(), eq: vi.fn(), target: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace, getContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { recordObservation } from "@/app/actions/reporting";
const org = "11111111-1111-4111-8111-111111111111", post = "22222222-2222-4222-8222-222222222222";
const form = () => { const input = new FormData(); input.set("publication_id", post); input.set("visibility", "live"); input.set("comments_total", ""); input.set("notes", "Authorized exact-post observation"); input.set("reviewed", "on"); return input; };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.mockResolvedValue({ organization: { id: org }, db: { from: mocks.from, rpc: mocks.rpc } });
  const chain = { select: vi.fn(() => chain), eq: mocks.eq, maybeSingle: mocks.target };
  mocks.eq.mockReturnValue(chain); mocks.from.mockReturnValue(chain);
  mocks.target.mockResolvedValue({ data: { id: post }, error: null }); mocks.rpc.mockResolvedValue({ error: null });
});
it("checks an exact selected-business publication before the legacy observation RPC", async () => {
  const input = form(); expect((await recordObservation({}, input)).success).toContain("Manual observation saved");
  expect(mocks.workspace).toHaveBeenCalledWith(true, input);
  expect(mocks.from).toHaveBeenCalledWith("reporting_publications");
  expect(mocks.eq.mock.calls).toEqual([["organization_id", org], ["id", post]]);
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
it.each([{ data: null, error: null }, { data: null, error: { code: "unavailable" } }])("does not observe a missing, foreign or unreadable publication", async (result) => {
  mocks.target.mockResolvedValue(result);
  expect((await recordObservation({}, form())).error).toContain("selected business");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
