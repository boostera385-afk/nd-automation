import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { membershipsSchema, selectMembership, workspaceContext } from "@/lib/workspace-selection";
import { WorkspaceField, WorkspaceProvider } from "@/components/workspace-context";
const user = "11111111-1111-4111-8111-111111111111", a = "22222222-2222-4222-8222-222222222222", b = "33333333-3333-4333-8333-333333333333";
const memberships = [{ organization_id: a, role: "owner" as const }, { organization_id: b, role: "customer" as const }];
describe("untrusted workspace preferences", () => {
  it("selects one membership automatically, never one of several", () => {
    expect(selectMembership([], user)).toBeNull();
    expect(selectMembership(memberships.slice(0, 1), user)).toEqual(memberships[0]);
    expect(selectMembership(memberships, user)).toBeNull();
  });
  it("requires a current authorized selection and fails closed after revocation", () => {
    expect(selectMembership(memberships, user, workspaceContext(user, b))).toEqual(memberships[1]);
    expect(selectMembership(memberships.slice(0, 1), user, workspaceContext(user, b))).toBeNull();
    expect(selectMembership(memberships, user, workspaceContext(a, b))).toBeNull();
  });
  it("strictly validates membership identities, roles, extras and duplicates", () => {
    expect(membershipsSchema.safeParse(memberships).success).toBe(true);
    for (const rows of [[{ organization_id: "bad", role: "owner" }], [{ ...memberships[0], token: "fixture" }], [memberships[0], memberships[0]]]) expect(membershipsSchema.safeParse(rows).success).toBe(false);
  });
  it("renders only the current user/business context and fails closed outside the provider", () => {
    const scope = workspaceContext(user, a);
    const html = renderToStaticMarkup(<WorkspaceProvider value={scope}><WorkspaceField /></WorkspaceProvider>);
    expect(html).toContain(`name="workspaceContext" value="${scope}"`);
    expect(renderToStaticMarkup(<WorkspaceField />)).toContain('value=""');
    expect(html).not.toContain(b);
  });
});
