import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), read: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.workspace }));
vi.mock("@/lib/sheet-sync", () => ({ fetchMasterRows: mocks.read, SheetSyncError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
import { clearSheetConnection, saveSheetConnection, testSavedSheetConnection } from "@/app/actions/sheet-setup";
import { SheetSyncError } from "@/lib/sheet-sync";

const orgId = "11111111-1111-4111-8111-111111111111";
const SHEET = "https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz-1234567890/edit";
const SHEET_ID = "abcdefghijklmnopqrstuvwxyz-1234567890";
const ENDPOINT = "https://script.google.com/macros/s/fixture-deployment-id/exec";
const TOKEN = "a".repeat(32);
const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [key, value] of Object.entries(values)) f.set(key, value);
  return f;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.mockResolvedValue({ db: { rpc: mocks.rpc }, organization: { id: orgId } });
  mocks.rpc.mockResolvedValue({ error: null });
});

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

describe("2-step workspace-saved connection", () => {
  it("saves URL and token for the workspace through the narrow RPC, then refreshes the gates", async () => {
    const result = await saveSheetConnection({}, form({ sheet_input: SHEET, endpoint_url: ENDPOINT, sync_token: TOKEN, confirm_save: "on" }));
    expect(result.success).toContain("Connection saved");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reporting_save_sheet_sync", { org: orgId, sheet_id: SHEET_ID, endpoint_url: ENDPOINT, sync_token: TOKEN });
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/settings/sheet-setup");
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/master-sheet");
  });
  it("requires a recognised Sheet from step 1, a /exec URL, a valid token and the confirmation", async () => {
    const base = { sheet_input: SHEET, endpoint_url: ENDPOINT, sync_token: TOKEN, confirm_save: "on" };
    const cases: [Record<string, string>, string][] = [
      [{}, "step 1"],
      [{ ...base, sheet_input: orgId }, "step 1"],
      [{ ...base, endpoint_url: "https://evil.example.com/exec" }, "ends in /exec"],
      [{ ...base, endpoint_url: "https://script.google.com/macros/s/x/preview" }, "ends in /exec"],
      [{ ...base, sync_token: "short" }, "24–256"],
      [{ ...base, confirm_save: "" }, "confirmation"],
    ];
    for (const [override, expected] of cases) {
      const result = await saveSheetConnection({}, form(override));
      expect(result.error, JSON.stringify(override)).toContain(expected);
      expect(result.success).toBeUndefined();
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("reports a database rejection without echoing internals", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "DO_NOT_ECHO_CONSTRAINT_DETAIL" } });
    const result = await saveSheetConnection({}, form({ sheet_input: SHEET, endpoint_url: ENDPOINT, sync_token: TOKEN, confirm_save: "on" }));
    expect(result.error).toContain("could not be saved");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_ECHO_CONSTRAINT_DETAIL");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("clearing requires the confirmation and removes only the saved row", async () => {
    const denied = await clearSheetConnection({}, form({}));
    expect(denied.error).toContain("confirmation");
    expect(mocks.rpc).not.toHaveBeenCalled();
    const done = await clearSheetConnection({}, form({ confirm_clear: "on" }));
    expect(done.success).toContain("removed");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reporting_clear_sheet_sync", { org: orgId });
  });
});
