import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
import CatalogRevision from "@/app/dashboard/settings/services/[id]/page";

const org = "11111111-1111-4111-8111-111111111111";
const revId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const rule = { keyword: "Fixture service", searchTerm: "fixture", family: "Fixtures", subcategory: "Fixture", businessSignals: [], reviewSignals: [], requiredSignals: [], topicSignals: [], excludeSignals: [], topicRequired: false, collectFamilyInventory: true, rewriteServicePhrase: "", equivalentServicePhrases: [] };
function chain(result: unknown) {
  const step: Record<string, unknown> = {
    select: () => step, eq: () => step, order: () => step, limit: () => step,
    abortSignal: () => step, maybeSingle: () => Promise.resolve(result),
  };
  step.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return step;
}
function makeDb(heads: unknown, revision: unknown, catalog: unknown) {
  return {
    from: (name: string) => chain(name.endsWith("catalog_heads") ? heads : revision),
    rpc: () => chain(catalog),
  };
}
async function render(id: string, role = "owner", heads: unknown, revision: unknown, catalog: unknown) {
  mocks.requireWorkspace.mockResolvedValue({ db: makeDb(heads, revision, catalog), organization: { id: org }, user: { email_confirmed_at: "2026-10-29T00:00:00Z" }, membership: { role } });
  return renderToStaticMarkup(await CatalogRevision({ params: Promise.resolve({ id }) }));
}
const ok = (data: unknown) => ({ data, error: null });
beforeEach(() => { vi.resetAllMocks(); });

it("requires verification and a valid revision ID before any backend read", async () => {
  const guarded = { from: () => { throw new Error("must not read"); }, rpc: () => { throw new Error("must not read"); } };
  mocks.requireWorkspace.mockResolvedValue({ db: guarded, organization: { id: org }, user: { email_confirmed_at: "2026-10-29T00:00:00Z" }, membership: { role: "owner" } });
  expect(renderToStaticMarkup(await CatalogRevision({ params: Promise.resolve({ id: "not-a-uuid" }) }))).toContain("Configuration review unavailable");
  mocks.requireWorkspace.mockResolvedValue({ db: guarded, organization: { id: org }, user: {}, membership: { role: "owner" } });
  expect(renderToStaticMarkup(await CatalogRevision({ params: Promise.resolve({ id: revId }) }))).toContain("Configuration review unavailable");
});

it("shows exact added/removed/changed/unchanged counts with full before/after rule JSON", async () => {
  const html = await render(revId, "owner",
    ok({ active_revision_id: otherId, activation_version: 3 }),
    ok({ id: revId, revision: 1, rules: [rule] }),
    ok({ version: 1, organizationId: org, generation: 3, revisionId: otherId, revision: 2, rules: [rule, { ...rule, keyword: "Removed pending service" }] }));
  expect(html).toContain("0 added · 1 removed · 0 changed · 1 unchanged.");
  expect(html).toContain("Removed pending service — removed");
  expect(html).toContain("Currently published");
  expect(html).toContain("Review service revision 1");
  expect(html).toContain('name="expectedVersion"');
  expect(html).toContain("Activate this exact configuration revision");
  expect(html).toContain("This does not start collection or apply rules to Fudge");
  expect(html).toContain(revId);
});

it("keeps operators and non-owners in review-only mode without an activation form", async () => {
  const html = await render(revId, "operator",
    ok({ active_revision_id: null, activation_version: 0 }),
    ok({ id: revId, revision: 1, rules: [rule] }),
    ok(null));
  expect(html).toContain("Only a verified owner or admin can activate rules");
  expect(html).toContain("1 added · 0 removed · 0 changed · 0 unchanged.");
  expect(html).not.toContain("<form");
});

it("does not offer activation when the exact reviewed revision is already active", async () => {
  const html = await render(revId, "owner",
    ok({ active_revision_id: revId, activation_version: 1 }),
    ok({ id: revId, revision: 1, rules: [rule] }),
    ok({ version: 1, organizationId: org, generation: 1, revisionId: revId, revision: 1, rules: [rule] }));
  expect(html).toContain("This exact revision is already active.");
  expect(html).not.toContain("<form");
});

it("fails closed without an activation form when independent reads disagree", async () => {
  const html = await render(revId, "owner",
    ok({ active_revision_id: otherId, activation_version: 3 }),
    ok({ id: revId, revision: 1, rules: [rule] }),
    ok({ version: 1, organizationId: org, generation: 2, revisionId: otherId, revision: 2, rules: [rule] }));
  expect(html).toContain("Configuration review unavailable");
  expect(html).toContain("No activation was requested");
  expect(html).not.toContain("<form");
  const denied = await render(revId, "owner", ok({ error: "denied" }), ok(null), ok(null));
  expect(denied).toContain("Configuration review unavailable");
});
