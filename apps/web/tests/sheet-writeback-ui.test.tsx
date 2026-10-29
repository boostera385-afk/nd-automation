import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
import SheetWritebackPage from "@/app/dashboard/settings/sheet-writeback/page";

const org = "11111111-1111-4111-8111-111111111111";
const pending = {
  id: "22222222-2222-4222-8222-222222222222", seq: 2, status: "pending", attempts: 0,
  intent: { action: "append", tab: "Auto Posting", rowRef: null, values: [{ "Profile Name": "Fixture profile", Status: "Filled" }] },
  lease_expires_at: null, last_error: null, created_at: "2026-10-29T12:00:00Z", delivered_at: null,
};
const delivered = {
  ...pending, id: "33333333-3333-4333-8333-333333333333", seq: 1, status: "delivered", attempts: 1, delivered_at: "2026-10-29T12:01:00Z",
};
function makeDb(list: unknown, total: number, listError = false) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: () => ({ abortSignal: () => Promise.resolve({ data: list, error: listError }) }) }),
          abortSignal: () => Promise.resolve({ data: null, error: null, count: total }),
        }),
      }),
    }),
  };
}
async function render(db: unknown, emailConfirmed = true) {
  mocks.requireWorkspace.mockResolvedValue({ db, organization: { id: org }, user: { email_confirmed_at: emailConfirmed ? "2026-10-29T00:00:00Z" : undefined }, membership: { role: "operator" } });
  return renderToStaticMarkup(await SheetWritebackPage({}));
}
beforeEach(() => { vi.resetAllMocks(); });
it("requires a verified email before any queue read", async () => {
  const guarded = { from: () => { throw new Error("must not read"); } };
  expect(await render(guarded, false)).toContain("Verify your email");
});
it("fails closed when the queue read cannot be verified", async () => {
  expect(await render(makeDb([pending], 1, true))).toContain("could not be verified");
  expect(await render(makeDb([{ ...pending, intent: { action: "drop" } }], 1))).toContain("could not be verified");
  expect(await render(makeDb([{ ...pending, seq: "2" }], 1))).toContain("could not be verified");
});
it("renders the inactive-delivery boundary, bounded status and per-item exact intents", async () => {
  const html = await render(makeDb([pending, delivered], 2));
  expect(html).toContain("Delivery is not active");
  expect(html).toContain("No connector, worker or Edge Function writes any Sheet through this queue yet");
  expect(html).toContain("no Sheet cell is touched");;
  expect(html).toContain("Append row to Auto Posting");
  expect(html).toContain("newest 2 of 2");
  expect(html).toContain("1 delivered");
  expect(html).toContain("Queue write intent");
  expect(html).toContain("name=\"stableKey\"");
});
it("offers pending-only cancellation and never a cancel for terminal rows", async () => {
  const html = await render(makeDb([pending, delivered], 2));
  expect(html.match(/Cancel pending/g)?.length).toBe(1);
  expect(html).toContain(`value="${pending.id}"`);
  expect(html).toContain(`delivered ${new Date(delivered.delivered_at!).toISOString()}`);
  expect(html).not.toContain(`value="${delivered.id}"`);
});
it("shows an explicit empty state without inventing queue activity", async () => {
  const html = await render(makeDb([], 0));
  expect(html).toContain("No writeback intents are recorded");
  expect(html).toContain("active");
});
