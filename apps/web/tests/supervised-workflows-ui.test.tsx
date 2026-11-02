import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace }));
vi.mock("@/app/actions/supervised-workflows", () => ({ enqueueSupervisedWorkflow: vi.fn() }));
vi.mock("@/app/actions/automation-tasks", () => ({ cancelBrowserTask: vi.fn(), reconcileExpiredBrowserTask: vi.fn() }));
import Workflows from "@/app/dashboard/workflows/page";
beforeEach(() => {
  vi.clearAllMocks(); mocks.workspace.mockResolvedValue({ organization: { id: "11111111-1111-4111-8111-111111111111" }, db: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: 1, error: null }) });
  mocks.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => Promise.resolve({ data: [], error: null }) }; return query;
  });
});
it("offers no mutation controls when reviewed protocol is missing", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ error: { code: "42883" } }) });
  const html = renderToStaticMarkup(await Workflows()); expect(html).toContain("Reviewed migration required"); expect(html).not.toContain("Authorize one supervised task");
  expect(mocks.from).not.toHaveBeenCalled();
});
it("labels identity handoff, no secrets and no invented coverage explicitly", async () => {
  const html = renderToStaticMarkup(await Workflows());
  expect(html).toContain("Authorize one supervised task"); expect(html).toContain("name=\"workspaceContext\"");
  expect(html).toContain("No email, password, OTP, birth date, residence"); expect(html).toContain("Receipt recorded is not the same as action verified");
  expect(html).toContain("Those require separately sourced observations"); expect(html).toContain("/dashboard/run/cohorts");
  expect(html).not.toContain('type="password"');
});
