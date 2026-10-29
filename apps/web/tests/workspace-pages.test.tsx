import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), access: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/data", () => ({ getIdentity: mocks.identity, getWorkspaceAccess: mocks.access }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/auth-screen", () => ({ AuthScreen: ({ title, description, children }: { title: string; description: string; children: ReactNode }) => <main><h1>{title}</h1><p>{description}</p>{children}</main> }));
vi.mock("@/app/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/app/actions/workspaces", () => ({ selectWorkspace: vi.fn() }));
import Workspaces from "@/app/workspaces/page";
import VerifyEmail from "@/app/verify-email/page";
const user = "11111111-1111-4111-8111-111111111111", org = "22222222-2222-4222-8222-222222222222";
const page = (notice?: string) => Workspaces({ searchParams: Promise.resolve({ notice }) });
let result: { data: unknown; error: unknown };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ user: { id: user, email_confirmed_at: null } });
  mocks.access.mockResolvedValue({ user: { id: user }, db: { from: mocks.from }, memberships: [{ organization_id: org, role: "customer" }] });
  result = { data: [{ id: org, name: "Fixture business" }], error: null };
  const chain = { select: vi.fn(() => chain), in: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(async () => result) };
  mocks.from.mockReturnValue(chain);
});
it("shows internal administrator handoff without querying business data or promising email delivery", async () => {
  const html = renderToStaticMarkup(await VerifyEmail());
  expect(html).toContain("Email confirmation required"); expect(html).toContain("contact your administrator");
  expect(html).toContain("self-service recovery are not configured");
  expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
});
it("leaves the confirmation page once the live identity is confirmed", async () => {
  mocks.identity.mockResolvedValue({ user: { id: user, email_confirmed_at: "2026-10-29T00:00:00Z" } });
  await expect(VerifyEmail()).rejects.toThrow("redirect:/dashboard");
});
it("lists exact authorized IDs/roles with no default business and explicit confirmation", async () => {
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("Choose your business"); expect(html).toContain(`value="${org}"`);
  expect(html).toContain("customer"); expect(html).toContain('name="confirmed"');
  expect(html).toContain('value="" disabled="" selected=""');
  expect(html).toContain("does not start, pause, or stop any worker");
});
it("explains rejected old-tab actions without echoing an untrusted notice", async () => {
  expect(renderToStaticMarkup(await page("context-changed"))).toContain("No operation was requested by that form");
  expect(renderToStaticMarkup(await page("untrusted-private-notice"))).not.toContain("untrusted-private-notice");
});
it("offers setup rather than a duplicate team membership when no business is assigned", async () => {
  mocks.access.mockResolvedValue({ user: { id: user }, memberships: [] });
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("Ask your team owner for access"); expect(html).toContain("Account setup");
  expect(mocks.from).not.toHaveBeenCalled();
});
it.each([null, [], [{ id: user, name: "Unrelated business" }], [{ id: org, name: "One" }, { id: org, name: "Duplicate" }]])("does not render an incomplete, duplicate or foreign business list", async (data) => {
  result.data = data;
  await expect(page()).rejects.toThrow("could not be verified completely");
});
it("does not mask a failed business read as empty access", async () => {
  result.error = { code: "unavailable" };
  await expect(page()).rejects.toThrow("could not be verified completely");
});
