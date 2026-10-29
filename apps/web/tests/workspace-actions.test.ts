import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), set: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/data", () => ({ getWorkspaceAccess: mocks.access }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { selectWorkspace } from "@/app/actions/workspaces";
import { WORKSPACE_COOKIE, workspaceContext } from "@/lib/workspace-selection";
const user = "11111111-1111-4111-8111-111111111111", org = "22222222-2222-4222-8222-222222222222";
const form = () => { const result = new FormData(); result.set("actor", user); result.set("workspace", org); result.set("confirmed", "on"); return result; };
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ user: { id: user }, memberships: [{ organization_id: org, role: "customer" }] }); });
it("rechecks verified membership and sets a session-only protected preference without business writes", async () => {
  await expect(selectWorkspace({}, form())).rejects.toThrow("redirect:/dashboard");
  expect(mocks.access).toHaveBeenCalledOnce();
  expect(mocks.set).toHaveBeenCalledWith(WORKSPACE_COOKIE, workspaceContext(user, org), { httpOnly: true, secure: false, sameSite: "lax", path: "/" });
  expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout");
});
it.each(["missing", "forged", "revoked", "duplicate", "actor", "unconfirmed"])("refuses %s selection without setting a cookie", async (mode) => {
  const input = form();
  if (mode === "missing") input.delete("workspace");
  if (mode === "forged") input.set("workspace", user);
  if (mode === "revoked") mocks.access.mockResolvedValue({ user: { id: user }, memberships: [] });
  if (mode === "duplicate") input.append("workspace", org);
  if (mode === "actor") input.set("actor", org);
  if (mode === "unconfirmed") input.delete("confirmed");
  expect((await selectWorkspace({}, input)).error).toBeTruthy();
  expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("cannot bypass the central identity/confirmation gate", async () => {
  mocks.access.mockRejectedValue(new Error("redirect:/verify-email"));
  await expect(selectWorkspace({}, form())).rejects.toThrow("redirect:/verify-email");
  expect(mocks.set).not.toHaveBeenCalled();
});
it("sets secure cookies in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    await expect(selectWorkspace({}, form())).rejects.toThrow("redirect:/dashboard");
    expect(mocks.set.mock.calls[0][2].secure).toBe(true);
    expect(mocks.set.mock.calls[0][2]).not.toHaveProperty("maxAge");
  } finally { vi.unstubAllEnvs(); }
});
