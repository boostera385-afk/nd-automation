import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), getContentTargets: vi.fn(), protocol: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("@/lib/content-data", () => ({ getContentTargets: mocks.getContentTargets }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/app/actions/content", () => ({ reviewContentDraft: vi.fn(), saveContentDraft: vi.fn() }));
vi.mock("@/app/actions/publishing", () => ({ enqueueApprovedPublish: vi.fn() }));
import ContentDetail from "@/app/dashboard/content/[id]/page";

const id = "44444444-4444-4444-8444-444444444444";
const target = { id: "binding", customer_id: "customer", profile_id: "profile", worker_id: "worker", account_label: "Authorized account" };
let status: string;
beforeEach(() => {
  vi.resetAllMocks(); status = "approved";
  const content = { kind: "post", title: "Approved fixture title", body: "Genuine approved fixture body", audience: "neighborhood", category: null, price_cents: null };
  const query = (table: string) => {
    const value = {
      select: () => value, eq: () => value, order: () => value,
      maybeSingle: async () => ({ error: null, data: { id, binding_id: "binding", content, status, revision: 2, updated_at: "2026-11-02T12:00:00Z", approved_at: "2026-11-02T12:00:00Z" } }),
      limit: async () => ({ error: null, data: table === "reporting_content_revisions" ? [{ revision: 2, event: "approved", content, target, actor_id: "actor", created_at: "2026-11-02T12:00:00Z" }] : [] }),
    };
    return value;
  };
  mocks.protocol.mockResolvedValue({ data: 1, error: null });
  mocks.getContentTargets.mockResolvedValue({ targets: [target], limited: false });
  mocks.requireWorkspace.mockResolvedValue({ organization: { id: "org", time_zone: "America/Los_Angeles" }, db: { from: query, rpc: mocks.protocol } });
});

it("offers a separate explicit supervised queue action only for the unchanged approved revision", async () => {
  const html = renderToStaticMarkup(await ContentDetail({ params: Promise.resolve({ id }) }));
  expect(html).toContain("Queue approved revision for supervised publishing");
  expect(html).toContain('name="expected_revision" value="2"');
  expect(html).toContain("I have permission to publish this content");
  expect(html).toContain("never silently falls back to text-only");
  expect(html).toContain("Live browser acceptance remains pending");
  expect(html).toContain("Session-bounded scheduling");
  expect(html).not.toContain("Approved — not dispatched");
});
it("does not expose publishing authorization for a draft", async () => {
  status = "draft";
  const html = renderToStaticMarkup(await ContentDetail({ params: Promise.resolve({ id }) }));
  expect(html).not.toContain("Queue approved revision for supervised publishing");
});
it("blocks queueing if the safety protocol is missing", async () => {
  mocks.protocol.mockResolvedValue({ data: null, error: { code: "42883" } });
  const html = renderToStaticMarkup(await ContentDetail({ params: Promise.resolve({ id }) }));
  expect(html).toContain("safety migration is not available");
  expect(html).not.toContain("Queue approved revision for supervised publishing");
});
it("does not offer queueing after the target assignment changed", async () => {
  mocks.getContentTargets.mockResolvedValue({ targets: [{ ...target, profile_id: "changed-profile" }], limited: false });
  const html = renderToStaticMarkup(await ContentDetail({ params: Promise.resolve({ id }) }));
  expect(html).toContain("assignment is unavailable or changed");
  expect(html).not.toContain("Queue approved revision for supervised publishing");
});
