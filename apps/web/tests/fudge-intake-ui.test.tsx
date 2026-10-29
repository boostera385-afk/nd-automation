import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("@/lib/fudge-intake-status", () => ({ fetchFudgeIntakeStatus: mocks.fetch }));
import FudgeIntake from "@/app/dashboard/fudge/page";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ db: {}, organization: { id: "fixture-business" }, user: { email_confirmed_at: "2026-10-29T00:00:00Z" } });
  mocks.fetch.mockResolvedValue({ available: true, records: 0, revisions: 0, recent: [], limited: false, loadedAt: "2026-10-29T12:00:00Z" });
});
it("requires staff access before loading any intake metadata", async () => {
  mocks.requireWorkspace.mockRejectedValue(new Error("Denied"));
  await expect(FudgeIntake()).rejects.toThrow("Denied");
  expect(mocks.requireWorkspace).toHaveBeenCalledWith(true); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("requires verified email before any metadata reads", async () => {
  mocks.requireWorkspace.mockResolvedValue({ db: {}, organization: { id: "fixture-business" }, user: {} });
  expect(renderToStaticMarkup(await FudgeIntake())).toContain("Verify your email");
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("distinguishes local data from empty backend reads and explains reconciliation limits", async () => {
  const html = renderToStaticMarkup(await FudgeIntake());
  expect(html).toContain("does not mean local reviews were lost");
  expect(html).toContain("not an atomic reconciliation snapshot");
  expect(html).toContain("cannot see a device-local");
  expect(html).toContain("upload release remains off");
  expect(html).not.toContain("<form");
});
it("never presents failed reads as an empty library", async () => {
  mocks.fetch.mockResolvedValue({ available: false, records: null, revisions: null, recent: [], loadedAt: "fixture-time" });
  const html = renderToStaticMarkup(await FudgeIntake());
  expect(html).toContain('role="alert"');
  expect(html).toContain("not evidence of an empty library");
  expect(html).not.toContain("No backend source records were visible");
});
it("shows exact receipt IDs, truncation and UTC timestamps without remote media", async () => {
  mocks.fetch.mockResolvedValue({ available: true, records: 70, revisions: 90, limited: true, loadedAt: "fixture-time", recent: [{ id: "fixture-revision", record_id: "fixture-record", revision: 2, payload_sha256: "a".repeat(64), observed_at: "2026-10-28T00:00:00Z", received_at: "2026-10-29T00:00:00Z" }] });
  const html = renderToStaticMarkup(await FudgeIntake());
  expect(html).toContain("fixture-record"); expect(html).toContain("fixture-revision");
  expect(html).toContain("50 most recently received"); expect(html).toContain("2026-10-29T00:00:00.000Z");
  expect(html).not.toContain("<img");
});
