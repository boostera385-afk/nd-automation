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
