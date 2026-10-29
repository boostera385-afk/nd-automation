import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_COOKIE, workspaceContext } from "@/lib/workspace-selection";

const mocks = vi.hoisted(() => ({ config: vi.fn(), client: vi.fn(), user: vi.fn(), from: vi.fn(), cookie: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ publicConfig: mocks.config }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

// Do not mock @/lib/data: exercise its actual authentication, membership,
// workspace-selection and stale-form checks with a transport boundary fixture.
import { getContext, getDashboardData, getPublication, getWorkspaceAccess, requireWorkspace } from "@/lib/data";
import { setBatchMonitoring } from "@/app/actions/workflow";
import { registerWorker } from "@/app/actions/workers";
import { stageServiceCatalog } from "@/app/actions/service-catalog";
import { enqueueSheetWriteback } from "@/app/actions/sheet-writeback";
import { sessionAction, confirmImport } from "@/app/actions/reporting";
import { confirmProfileImport } from "@/app/actions/profiles";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/operations-data", () => ({ getOperationsData: vi.fn(() => { throw new Error("Unexpected operational read"); }) }));
vi.mock("@/lib/sheet-sync", () => ({ fetchSheetRows: vi.fn(), SheetSyncError: Error }));

const userId = "11111111-1111-4111-8111-111111111111";
const otherUser = "22222222-2222-4222-8222-222222222222";
const orgA = "33333333-3333-4333-8333-333333333333";
const orgB = "44444444-4444-4444-8444-444444444444";
const membership = (organization_id = orgA, role = "owner") => ({ organization_id, role });
let memberResult: { data: unknown; error: unknown };
let organizationResult: { data: unknown; error: unknown };

function query(table: string) {
  const result = () => table === "reporting_memberships" ? memberResult : organizationResult;
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(() => chain),
    single: vi.fn(async () => result()),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return chain;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ url: "https://fixture.example", key: "fixture" });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, from: mocks.from });
  mocks.user.mockResolvedValue({ data: { user: { id: userId, email_confirmed_at: "2026-10-29T00:00:00Z" } }, error: null });
  memberResult = { data: [membership()], error: null };
  organizationResult = { data: { id: orgA, name: "Fixture business", time_zone: "America/Los_Angeles" }, error: null };
  mocks.from.mockImplementation(query);
});

describe("real central dashboard data-access guard", () => {
  it("refuses invalid public configuration before creating a client", async () => {
    mocks.config.mockReturnValue(null);
    await expect(getContext()).rejects.toThrow("redirect:/login");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([null, { id: userId }])("rejects missing/unconfirmed identity before any business query", async (user) => {
    mocks.user.mockResolvedValue({ data: { user }, error: null });
    await expect(getContext()).rejects.toThrow(user ? "redirect:/verify-email" : "redirect:/login");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not trust a returned user alongside an Auth error", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: userId, email_confirmed_at: "fixture" } }, error: { message: "unavailable" } });
    await expect(requireWorkspace(true)).rejects.toThrow("redirect:/login");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("protects data reads, post routes and direct actions without mocking requireWorkspace", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: userId, email_confirmed_at: null } }, error: null });
    for (const operation of [getDashboardData, () => getPublication(orgA), () => setBatchMonitoring({}, new FormData())]) {
      await expect(operation()).rejects.toThrow("redirect:/verify-email");
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("retains explicit first-account setup for a verified user with no memberships", async () => {
    memberResult.data = [];
    expect(await getContext()).toMatchObject({ membership: null, organization: null, isStaff: false, memberships: [] });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["reporting_memberships"]);
  });
  it("auto-selects the only membership and reads only its exact organization", async () => {
    const chain = query("reporting_memberships");
    mocks.from.mockImplementation((table) => table === "reporting_memberships" ? chain : query(table));
    expect(await requireWorkspace(true)).toMatchObject({ membership: membership(), organization: { id: orgA }, isStaff: true });
    expect(chain.eq).toHaveBeenCalledWith("user_id", userId);
    expect(chain.order).toHaveBeenCalledWith("organization_id");
    expect(chain.limit).toHaveBeenCalledWith(101);
    expect(mocks.cookie).toHaveBeenCalledWith(WORKSPACE_COOKIE);
  });
  it("never arbitrarily picks the first of several memberships", async () => {
    memberResult.data = [membership(), membership(orgB)];
    await expect(getContext()).rejects.toThrow("redirect:/workspaces");
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["reporting_memberships"]);
  });
  it("honors a matching account preference only while membership exists", async () => {
    memberResult.data = [membership(), membership(orgB, "operator")];
    mocks.cookie.mockReturnValue({ value: workspaceContext(userId, orgB) });
    organizationResult.data = { id: orgB, name: "Other fixture", time_zone: "America/Los_Angeles" };
    expect(await getContext()).toMatchObject({ membership: membership(orgB, "operator"), organization: { id: orgB } });
    memberResult.data = [membership()];
    await expect(getContext()).rejects.toThrow("redirect:/workspaces");
  });
  it("does not inherit another user's multi-business preference", async () => {
    memberResult.data = [membership(), membership(orgB)];
    mocks.cookie.mockReturnValue({ value: workspaceContext(otherUser, orgB) });
    await expect(getContext()).rejects.toThrow("redirect:/workspaces");
  });
  it.each([null, [{ organization_id: orgA, role: "superuser" }], [membership(), membership()], Array(101).fill(membership())])("fails closed on incomplete/malformed membership results", async (data) => {
    memberResult.data = data;
    await expect(getWorkspaceAccess()).rejects.toThrow("could not be verified completely");
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["reporting_memberships"]);
  });
  it("does not treat membership transport failure as an empty account", async () => {
    memberResult = { data: [], error: { code: "unavailable" } };
    await expect(getContext()).rejects.toThrow("incomplete or unavailable");
  });
  it.each([null, { id: orgB, name: "Wrong business", time_zone: "UTC" }])("refuses a missing or mismatched organization", async (data) => {
    organizationResult.data = data;
    await expect(getContext()).rejects.toThrow("workspace could not be loaded");
  });
  it("allows customer reporting context but refuses staff access", async () => {
    memberResult.data = [membership(orgA, "customer")];
    expect(await requireWorkspace()).toMatchObject({ isStaff: false });
    await expect(requireWorkspace(true)).rejects.toThrow("Your role cannot change");
  });
  it("accepts exactly one matching form context, never a client-supplied role", async () => {
    const form = new FormData(); form.set("workspaceContext", workspaceContext(userId, orgA)); form.set("role", "owner");
    expect(await requireWorkspace(true, form)).toMatchObject({ organization: { id: orgA } });
    form.append("workspaceContext", workspaceContext(userId, orgA));
    await expect(requireWorkspace(true, form)).rejects.toThrow("redirect:/workspaces?notice=context-changed");
  });
  it.each(["", workspaceContext(otherUser, orgA), workspaceContext(userId, orgB)])("rejects stale account/business forms and notification calls", async (expected) => {
    const form = new FormData(); if (expected) form.set("workspaceContext", expected);
    await expect(requireWorkspace(true, form)).rejects.toThrow("redirect:/workspaces?notice=context-changed");
    await expect(requireWorkspace(false, expected)).rejects.toThrow("redirect:/workspaces?notice=context-changed");
  });
  it.each([setBatchMonitoring, registerWorker, stageServiceCatalog, enqueueSheetWriteback, sessionAction, confirmImport, confirmProfileImport])("blocks real mutation entrypoint %s before dispatch after an old-tab submission", async (action) => {
    const form = new FormData(); form.set("workspaceContext", workspaceContext(userId, orgB));
    await expect(action({}, form)).rejects.toThrow("redirect:/workspaces?notice=context-changed");
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["reporting_memberships", "reporting_organizations"]);
  });
});
