import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace }));
vi.mock("@/lib/sheet-sync", () => ({ fetchMasterRows: mocks.read, SheetSyncError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
import { testSavedSheetConnection } from "@/app/actions/sheet-setup";
import { SheetSyncError } from "@/lib/sheet-sync";

beforeEach(() => { vi.resetAllMocks(); mocks.workspace.mockResolvedValue({}); });

describe("saved Sheet setup connection test", () => {
  it("requires staff access before contacting Google", async () => {
    mocks.workspace.mockRejectedValue(new Error("private diagnostic"));
    const result = await testSavedSheetConnection();
    expect(mocks.workspace).toHaveBeenCalledWith(true);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(result.error).toContain("staff access");
    expect(JSON.stringify(result)).not.toContain("private diagnostic");
  });
  it("reads only the saved allowlisted tab and returns counts rather than row contents", async () => {
    mocks.read.mockResolvedValue({ rows: [{ profileName: "DO_NOT_ECHO_PRIVATE_ROW" }], truncated: false });
    const result = await testSavedSheetConnection();
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("Auto Posting");
    expect(result.success).toContain("1 safe metadata rows");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_ECHO_PRIVATE_ROW");
  });
  it("reports truncated coverage and handles a valid empty Sheet", async () => {
    mocks.read.mockResolvedValueOnce({ rows: [], truncated: true });
    expect((await testSavedSheetConnection()).success).toContain("source truncated");
    mocks.read.mockResolvedValueOnce({ rows: [], truncated: false });
    expect((await testSavedSheetConnection()).success).toContain("0 safe metadata rows");
  });
  it("returns the transport's redacted setup error, not raw exceptions", async () => {
    mocks.read.mockRejectedValue(new SheetSyncError("unauthorized", "The sheet connection rejected the secret token."));
    expect((await testSavedSheetConnection()).error).toContain("rejected the secret token");
    mocks.read.mockRejectedValue(new Error("DO_NOT_ECHO_PRIVATE_TOKEN"));
    expect(JSON.stringify(await testSavedSheetConnection())).not.toContain("DO_NOT_ECHO_PRIVATE_TOKEN");
  });
});
