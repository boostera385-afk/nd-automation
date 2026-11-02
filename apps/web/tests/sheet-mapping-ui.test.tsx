import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("@/app/actions/sheet-writeback", () => ({ setPublicationSheetMapping: vi.fn(), setPublishSheetTarget: vi.fn() }));
import SheetMapping from "@/app/dashboard/settings/sheet-mapping/page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ organization: { id: "11111111-1111-4111-8111-111111111111" }, db: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: 1, error: null }) });
  mocks.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
      abortSignal: () => Promise.resolve({ data: [], error: null }) }; return query;
  });
});
it("keeps controls disabled when the reviewed migration is absent", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: null, error: { code: "42883" } }) });
  const html = renderToStaticMarkup(await SheetMapping()); expect(html).toContain("Mapping source is not deployed");
  expect(html).not.toContain("Save exact publication mapping"); expect(mocks.from).not.toHaveBeenCalled();
});
it("makes all future-write permissions opt-in and explains pause, technical outcomes and no historical replay", async () => {
  const html = renderToStaticMarkup(await SheetMapping()); expect(html).toContain("Save exact publication mapping");
  expect(html).toContain("value=\"false\" selected=\"\""); expect(html).toContain("technical failures must not be presented as removals");
  expect(html).toContain("Pausing mappings does not cancel existing pending/leased intents"); expect(html).toContain("Queued is not delivered");
  expect(html.match(/name="workspaceContext"/g)).toHaveLength(2);
});
