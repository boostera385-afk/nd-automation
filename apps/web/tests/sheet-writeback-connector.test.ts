import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

const source = readFileSync(new URL("../../../integrations/sheets/reporting-writeback.gs", import.meta.url), "utf8");
const org = "11111111-1111-4111-8111-111111111111";
const operation = "22222222-2222-4222-8222-222222222222";
const rowId = "33333333-3333-4333-8333-333333333333";
type Intent = { action: string; tab: string; rowRef: string | null; values: Array<Record<string, string | null>> };
const intent = (): Intent => ({ action: "append", tab: "Auto Posting", rowRef: null,
  values: [{ "ND Row ID": rowId, Status: "Filled", "Post Text": "=not a formula 😀" }] });
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

function fixture() {
  const props: Record<string, string> = { WRITE_TOKEN: "fixture-token-".repeat(4), ORGANIZATION_ID: org, SHEET_ID: "fixture-spreadsheet",
    WRITE_ENABLED: "true", WRITE_COLUMNS_JSON: JSON.stringify({ "Auto Posting": ["Profile Name", "Status", "Post link", "Post Text"] }) };
  const headers = ["Profile Name", "Password", "Status", "ND Row ID", "ND Revision", "Post Text", "Post link"];
  const state = { grid: [headers, ["Original", "PRIVATE_PASSWORD", "Waiting", "44444444-4444-4444-8444-444444444444", "1", "Original body", ""]] as string[][],
    metadata: [] as Array<{ metadataKey: string; metadataValue: string }>, batches: [] as Array<Record<string, unknown>[]>,
    reads: [] as number[], maxRows: 2, locked: true, failBatch: false, failAfterCommit: false, failReceiptRead: false };
  const sheet = {
    getLastRow: () => state.grid.length, getLastColumn: () => headers.length, getSheetId: () => 7, getMaxRows: () => state.maxRows,
    getRange: (row: number, column: number, count: number, width: number) => ({ getDisplayValues: () => {
      if (row > 1) state.reads.push(column);
      return Array.from({ length: count }, (_, index) => Array.from({ length: width }, (_, offset) => state.grid[row - 1 + index]?.[column - 1 + offset] ?? ""));
    } }),
  };
  const sheets = {
    DeveloperMetadata: { search: (request: { dataFilters: Array<{ developerMetadataLookup: { metadataKey: string } }> }) => {
      if (state.failReceiptRead && state.metadata.length) throw new Error("PRIVATE_GOOGLE_ERROR");
      return { matchedDeveloperMetadata: state.metadata.filter((value) => value.metadataKey === request.dataFilters[0].developerMetadataLookup.metadataKey)
        .map((developerMetadata) => ({ developerMetadata })) };
    } },
    batchUpdate: (request: { requests: Array<Record<string, unknown>> }) => {
      state.batches.push(request.requests);
      if (state.failBatch) throw new Error("PRIVATE_GOOGLE_ERROR");
      const grid = structuredClone(state.grid);
      const metadata = structuredClone(state.metadata);
      for (const operation of request.requests) {
        if (operation.updateCells) {
          const update = operation.updateCells as { start: { rowIndex: number; columnIndex: number }; rows: Array<{ values: Array<{ userEnteredValue?: { stringValue: string } }> }>; fields: string };
          expect(update.fields).toBe("userEnteredValue");
          const { rowIndex, columnIndex } = update.start;
          while (grid.length <= rowIndex) grid.push(new Array(headers.length).fill(""));
          grid[rowIndex][columnIndex] = update.rows[0].values[0].userEnteredValue?.stringValue ?? "";
        } else if (operation.createDeveloperMetadata) {
          metadata.push((operation.createDeveloperMetadata as { developerMetadata: { metadataKey: string; metadataValue: string } }).developerMetadata);
        } else if (operation.appendDimension) {
          state.maxRows += (operation.appendDimension as { length: number }).length;
        } else throw new Error("Unexpected batch operation");
      }
      state.grid = grid; state.metadata = metadata;
      if (state.failAfterCommit) { state.failAfterCommit = false; throw new Error("Lost HTTP response after atomic commit"); }
      return {};
    },
  };
  const context = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: (name: string) => props[name] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => state.locked, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name: string) => name === "Auto Posting" ? sheet : null }) },
    Sheets: { Spreadsheets: sheets }, Utilities: { DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: (_algorithm: string, value: string) => [...createHash("sha256").update(value).digest()],
      newBlob: (value: string) => ({ getBytes: () => [...Buffer.from(value)] }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (value: string) => ({ setMimeType: () => value }) } });
  vm.runInContext(source, context);
  function call(value = intent(), extra: Record<string, unknown> = {}) {
    context.input = JSON.stringify({ version: 1, action: "applyWrite", token: props.WRITE_TOKEN, organizationId: org, operationId: operation,
      intent: value, intentHash: hash(value), ...extra });
    return JSON.parse(vm.runInContext("doPost({postData:{contents:input}})", context));
  }
  return { state, props, headers, call };
}

it("commits cells and the replay receipt in ONE atomic batch with formula-safe string values", () => {
  const f = fixture(); const response = f.call();
  expect(response.ok).toBe(true); expect(response.receipt).toMatchObject({ version: 1, organizationId: org, operationId: operation, intentHash: hash(intent()), rowCount: 1 });
  expect(f.state.batches).toHaveLength(1); expect(f.state.metadata).toHaveLength(1);
  expect(f.state.batches[0].at(-1)).toHaveProperty("createDeveloperMetadata");
  expect(f.state.grid[2][5]).toBe("=not a formula 😀"); expect(f.state.grid[2][4]).toBe("1");
  expect(JSON.stringify(f.state.batches)).not.toContain("formulaValue");
  expect(JSON.stringify(response)).not.toContain("PRIVATE_PASSWORD");
  expect(f.state.reads).toEqual([4, 5]);
});
it("an exact replay or read-only receipt lookup cannot append a second row", () => {
  const f = fixture(); const first = f.call();
  expect(f.call()).toEqual(first); expect(f.call(intent(), { action: "lookupWrite" })).toEqual(first);
  expect(f.state.grid).toHaveLength(3); expect(f.state.batches).toHaveLength(1);
});
it("a changed intent under the same operation ID conflicts without another write", () => {
  const f = fixture(); f.call(); const changed = intent(); changed.values[0].Status = "Other";
  expect(f.call(changed)).toEqual({ ok: false, error: "operation_conflict" });
  expect(f.state.batches).toHaveLength(1);
});
it("a lookup before any commit is read-only and never appends", () => {
  const f = fixture(); expect(f.call(intent(), { action: "lookupWrite" })).toEqual({ ok: false, error: "not_found" });
  expect(f.state.batches).toHaveLength(0);
});
it("lost responses after atomic commit recover from the durable receipt, not duplicate work", () => {
  const f = fixture(); f.state.failAfterCommit = true;
  expect(f.call()).toEqual({ ok: false, error: "unconfirmed" });
  expect(f.call().ok).toBe(true); expect(f.state.batches).toHaveLength(1); expect(f.state.grid).toHaveLength(3);
});
it("a failed batch has no receipt or partial cell success, and raw errors remain private", () => {
  const f = fixture(); f.state.failBatch = true; const before = structuredClone(f.state.grid);
  expect(f.call()).toEqual({ ok: false, error: "unconfirmed" });
  expect(f.state.grid).toEqual(before); expect(f.state.metadata).toHaveLength(0);
});
it("a missing receipt read after commit stays unconfirmed and is recoverable", () => {
  const f = fixture(); f.state.failReceiptRead = true;
  expect(f.call()).toEqual({ ok: false, error: "unconfirmed" });
  f.state.failReceiptRead = false; expect(f.call().ok).toBe(true); expect(f.state.batches).toHaveLength(1);
});
it.each(["disabled", "wrong_organization", "unauthorized", "invalid_request"])("blocks %s before a write", (kind) => {
  const f = fixture(); const extra: Record<string, unknown> = {};
  if (kind === "disabled") f.props.WRITE_ENABLED = "false";
  if (kind === "wrong_organization") extra.organizationId = rowId;
  if (kind === "unauthorized") extra.token = "wrong-private-fixture";
  if (kind === "invalid_request") extra.arbitraryRange = "A1:Z100";
  expect(f.call(intent(), extra)).toEqual({ ok: false, error: kind }); expect(f.state.batches).toHaveLength(0);
});
it("the script lock refuses concurrent cooperating writers", () => {
  const f = fixture(); f.state.locked = false; expect(f.call()).toEqual({ ok: false, error: "busy" }); expect(f.state.batches).toHaveLength(0);
});
it("updates find a moved row by its stable ID and enforce the expected revision", () => {
  const f = fixture(); f.state.grid.splice(1, 0, ["Unrelated", "PRIVATE", "", "", "", "", ""]);
  const update: Intent = { action: "update_cells", tab: "Auto Posting", rowRef: "id:44444444-4444-4444-8444-444444444444",
    values: [{ Status: "Checked", __expected_revision: "1" }] };
  expect(f.call(update).ok).toBe(true); expect(f.state.grid[2][2]).toBe("Checked"); expect(f.state.grid[2][4]).toBe("2");
  expect(f.state.grid[1][2]).toBe("");
  expect(f.call(update, { operationId: rowId })).toEqual({ ok: false, error: "revision_conflict" });
});
it("duplicate or missing stable row identity cannot target an arbitrary first row", () => {
  const f = fixture(); f.state.grid.push([...f.state.grid[1]]);
  const update: Intent = { action: "update_cells", tab: "Auto Posting", rowRef: "id:44444444-4444-4444-8444-444444444444",
    values: [{ Status: "Checked", __expected_revision: "1" }] };
  expect(f.call(update)).toEqual({ ok: false, error: "row_identity_conflict" }); expect(f.state.batches).toHaveLength(0);
});
it("row numbers, arbitrary headers, credential columns and altered hashes are rejected", () => {
  const f = fixture(); const bad = intent(); bad.values[0].Password = "PRIVATE";
  expect(f.call(bad)).toEqual({ ok: false, error: "invalid_intent" });
  expect(f.call({ action: "update_cells", tab: "Auto Posting", rowRef: "A2", values: [{ Status: "Checked" }] })).toEqual({ ok: false, error: "invalid_intent" });
  expect(f.call(intent(), { intentHash: "0".repeat(64) })).toEqual({ ok: false, error: "invalid_intent" }); expect(f.state.batches).toHaveLength(0);
});
it("a column outside the operator's allowlist cannot be written even if globally safe", () => {
  const f = fixture(); f.props.WRITE_COLUMNS_JSON = JSON.stringify({ "Auto Posting": ["Status"] });
  expect(f.call()).toEqual({ ok: false, error: "column_not_allowed" }); expect(f.state.batches).toHaveLength(0);
});
it("missing or duplicate required headers refuse writes rather than guessing columns", () => {
  const f = fixture(); f.state.grid[0][1] = "Status";
  expect(f.call()).toEqual({ ok: false, error: "headers_conflict" }); expect(f.state.batches).toHaveLength(0);
});
it("append refuses an existing row ID and null explicitly clears only the selected safe cell", () => {
  const f = fixture(); const duplicate = intent(); duplicate.values[0]["ND Row ID"] = f.state.grid[1][3];
  expect(f.call(duplicate)).toEqual({ ok: false, error: "row_identity_conflict" });
  const update: Intent = { action: "update_cells", tab: "Auto Posting", rowRef: "id:44444444-4444-4444-8444-444444444444",
    values: [{ Status: null, __expected_revision: "1" }] };
  expect(f.call(update).ok).toBe(true); expect(f.state.grid[1][2]).toBe(""); expect(f.state.grid[1][1]).toBe("PRIVATE_PASSWORD");
});
it("control characters and oversized cells are refused without writes", () => {
  const f = fixture(); const bad = intent();
  for (const value of ["a\nb", "x".repeat(4001), "\ud800"]) {
    bad.values[0].Status = value; expect(f.call(bad)).toEqual({ ok: false, error: "invalid_intent" });
  }
  expect(f.state.batches).toHaveLength(0);
});
