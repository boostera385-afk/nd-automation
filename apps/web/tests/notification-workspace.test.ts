import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { workspaceContext } from "@/lib/workspace-selection";
const mocks = vi.hoisted(() => ({ context: vi.fn(), workspace: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/data", () => ({ getContext: mocks.context, requireWorkspace: mocks.workspace }));
import { GET } from "@/app/dashboard/notifications/feed/route";
import { markNotificationsSeen } from "@/app/actions/notifications";
const user = "11111111-1111-4111-8111-111111111111", org = "22222222-2222-4222-8222-222222222222";
let itemError: unknown = null, stateError: unknown = null;
const request = (scope = workspaceContext(user, org)) => new NextRequest(`http://localhost/dashboard/notifications/feed?workspaceContext=${encodeURIComponent(scope)}`);
beforeEach(() => {
  vi.resetAllMocks(); itemError = stateError = null;
  const context = { user: { id: user }, organization: { id: org }, db: { from: mocks.from, rpc: mocks.rpc } };
  mocks.context.mockResolvedValue(context); mocks.workspace.mockResolvedValue(context);
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table) => {
    const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(async () => ({ data: [], error: itemError })), maybeSingle: vi.fn(async () => ({ data: { last_seen_at: "2026-10-29T00:00:00Z" }, error: stateError })) };
    expect(["reporting_notifications", "reporting_notification_state"]).toContain(table);
    return chain;
  });
});
it("rejects stale/foreign/missing feed contexts without notification queries", async () => {
  for (const scope of ["", workspaceContext(org, org), workspaceContext(user, user)]) {
    const result = await GET(request(scope)); expect(result.status).toBe(409);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(mocks.from).not.toHaveBeenCalled();
});
it("reads the same selected business as the dashboard through its central gate", async () => {
  const result = await GET(request()); expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ available: true, items: [] });
  for (const chain of mocks.from.mock.results) expect(chain.value.eq).toHaveBeenCalledWith("organization_id", org);
});
it("propagates identity/confirmation rejection before any feed data is queried", async () => {
  mocks.context.mockRejectedValue(new Error("redirect:/verify-email"));
  await expect(GET(request())).rejects.toThrow("redirect:/verify-email"); expect(mocks.from).not.toHaveBeenCalled();
});
it("does not report failed notification/state reads as an available empty feed", async () => {
  itemError = { code: "unavailable" };
  expect((await GET(request())).status).toBe(502);
  itemError = null; stateError = { code: "unavailable" };
  expect(await (await GET(request())).json()).toMatchObject({ available: false });
});
it("requires a current form context before acknowledging a notification", async () => {
  const scope = workspaceContext(user, org);
  expect(await markNotificationsSeen(scope)).toEqual({ ok: true });
  expect(mocks.workspace).toHaveBeenCalledWith(false, scope);
  expect(mocks.rpc).toHaveBeenCalledWith("reporting_mark_notifications_seen", { org });
});
it("does not acknowledge when the context gate rejects an old tab", async () => {
  mocks.workspace.mockRejectedValue(new Error("redirect:/workspaces?notice=context-changed"));
  await expect(markNotificationsSeen("old")).rejects.toThrow("context-changed"); expect(mocks.rpc).not.toHaveBeenCalled();
});
