import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const context = vi.hoisted(() => ({ requireWorkspace: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: context.requireWorkspace }));
import Services from "@/app/dashboard/settings/services/page";

it("requires staff access and verification before exposing the catalog input", async () => {
  context.requireWorkspace.mockRejectedValueOnce(new Error("Denied"));
  await expect(Services()).rejects.toThrow("Denied");
  expect(context.requireWorkspace).toHaveBeenCalledWith(true);
  context.requireWorkspace.mockResolvedValueOnce({ user: {} });
  const html = renderToStaticMarkup(await Services());
  expect(html).toContain("Verify your email"); expect(html).not.toContain('type="file"');
});
it("renders a local-only file preview without save, import or activation controls", async () => {
  context.requireWorkspace.mockResolvedValueOnce({ user: { email_confirmed_at: "2026-10-29T00:00:00Z" } });
  const html = renderToStaticMarkup(await Services());
  expect(html).toContain('type="file"');
  expect(html).toContain("no file upload, database write");
  expect(html).toContain("Current Fudge and Sheet settings stay unchanged");
  expect(html).not.toContain("<form"); expect(html).not.toContain("<button");
});
it("links saved revision receipts to exact-review pages and keeps staging bounded", async () => {
  const revisionId = "33333333-3333-4333-8333-333333333333";
  context.requireWorkspace.mockResolvedValueOnce({
    user: { email_confirmed_at: "2026-10-29T00:00:00Z" },
    organization: { id: "11111111-1111-4111-8111-111111111111" },
    db: {
      from: (name: string) => (name.endsWith("catalog_heads")
        ? { select: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: () => Promise.resolve({ data: { latest_revision: 1 }, error: null }) }) }) }) }
        : { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ abortSignal: () => Promise.resolve({ data: [{ id: revisionId, revision: 1, created_at: "2026-10-29T00:00:00Z" }], error: null }) }) }) }) }) }),
    },
  });
  const html = renderToStaticMarkup(await Services());
  expect(html).toContain(`href="/dashboard/settings/services/${revisionId}"`);
  expect(html).toContain("Review revision 1");
  expect(html).toContain("Latest saved revision at this read: 1");
  expect(html).toContain("Latest 20 revision receipts only");
  expect(html).toContain("2026-10-29T00:00:00.000Z (UTC)");
});
