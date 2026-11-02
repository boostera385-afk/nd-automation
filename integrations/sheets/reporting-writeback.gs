/**
 * ND writeback v1 — SEPARATE, opt-in standalone Apps Script project.
 * Never replace reporting-sync.gs, a fudge connector, or a desktop script.
 * Uses the Advanced Sheets service for atomic cell + replay-receipt commits.
 * Requires exclusive ownership of writable columns during the supervised pilot:
 * a ScriptLock cannot prevent another script or a human from editing the Sheet.
 * No triggers, account creation, arbitrary ranges, formulas or credential columns.
 */
const ND_WRITEBACK_VERSION = 1;
const ND_WB_SAFE_COLUMNS = ["Profile Name", "Post link", "Status", "Post Text", "Title"];
const ND_WB_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ND_WB_MAX_ROWS = 2000;

function doGet() { return wbJson_({ ok: false, error: "post_only" }); }

function doPost(e) {
  let lock;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== "string" || raw.length > 100000) return wbJson_({ ok: false, error: "invalid_request" });
    const body = JSON.parse(raw);
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("WRITE_TOKEN");
    const org = props.getProperty("ORGANIZATION_ID");
    const sheetId = props.getProperty("SHEET_ID");
    if (!token || token.length < 32 || !ND_WB_UUID.test(org || "") || !sheetId) return wbJson_({ ok: false, error: "not_configured" });
    if (!body || typeof body !== "object" || Array.isArray(body) || !wbEqual_(body.token, token)) return wbJson_({ ok: false, error: "unauthorized" });
    if (props.getProperty("WRITE_ENABLED") !== "true") return wbJson_({ ok: false, error: "disabled" });
    if (body.organizationId !== org) return wbJson_({ ok: false, error: "wrong_organization" });
    if (Object.keys(body).sort().join(",") !== "action,intent,intentHash,operationId,organizationId,token,version" || body.version !== 1 ||
        !ND_WB_UUID.test(body.operationId || "") || !/^[a-f0-9]{64}$/.test(body.intentHash || "") ||
        !["applyWrite", "lookupWrite"].includes(body.action)) return wbJson_({ ok: false, error: "invalid_request" });
    if (!wbValidIntent_(body.intent) || wbHash_(body.intent) !== body.intentHash) return wbJson_({ ok: false, error: "invalid_intent" });
    // One standalone deployment/project must own this target. Multiple independently
    // deployed script projects do not share a lock and are not supported writers.
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return wbJson_({ ok: false, error: "busy" });
    const key = "ndwb:" + org + ":" + body.operationId;
    const previous = wbReceipt_(sheetId, key);
    if (previous) {
      if (previous.intentHash !== body.intentHash || previous.organizationId !== org || previous.operationId !== body.operationId) {
        return wbJson_({ ok: false, error: "operation_conflict" });
      }
      return wbJson_({ ok: true, receipt: previous });
    }
    if (body.action === "lookupWrite") return wbJson_({ ok: false, error: "not_found" });
    const configured = JSON.parse(props.getProperty("WRITE_COLUMNS_JSON") || "{}");
    if (!configured || typeof configured !== "object" || Array.isArray(configured) || !Object.prototype.hasOwnProperty.call(configured, body.intent.tab)) {
      return wbJson_({ ok: false, error: "tab_not_allowed" });
    }
    const columns = configured[body.intent.tab];
    if (!["Auto Posting", "Auto Listing"].includes(body.intent.tab) || !Array.isArray(columns) || !columns.length ||
        new Set(columns).size !== columns.length || columns.some((name) => !ND_WB_SAFE_COLUMNS.includes(name))) {
      return wbJson_({ ok: false, error: "invalid_configuration" });
    }
    const sheet = SpreadsheetApp.openById(sheetId).getSheetByName(body.intent.tab);
    if (!sheet) return wbJson_({ ok: false, error: "sheet_not_found" });
    if (sheet.getLastRow() > ND_WB_MAX_ROWS || sheet.getLastColumn() > 100 || sheet.getLastColumn() < 1) {
      return wbJson_({ ok: false, error: "sheet_bounds" });
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const usedHeaders = columns.concat(["ND Row ID", "ND Revision"]);
    if (usedHeaders.some((name) => headers.filter((header) => header === name).length !== 1)) {
      return wbJson_({ ok: false, error: "headers_conflict" });
    }
    const count = Math.max(0, sheet.getLastRow() - 1);
    // Only stable identity/revision columns are read, never cookies/proxies/passwords.
    const read = (name) => count ? sheet.getRange(2, headers.indexOf(name) + 1, count, 1).getDisplayValues().map((r) => r[0]) : [];
    const ids = read("ND Row ID");
    const revisions = read("ND Revision");
    const intent = body.intent;
    const requests = [];
    let rows = [];
    const cell = (row, name, value) => requests.push({ updateCells: {
      start: { sheetId: sheet.getSheetId(), rowIndex: row - 1, columnIndex: headers.indexOf(name) },
      rows: [{ values: [value === null ? {} : { userEnteredValue: { stringValue: value } }] }], fields: "userEnteredValue"
    } });
    if (intent.action === "append") {
      const incoming = intent.values.map((value) => value["ND Row ID"]);
      if (new Set(incoming).size !== incoming.length || incoming.some((id) => !ND_WB_UUID.test(id || "") || ids.includes(id))) {
        return wbJson_({ ok: false, error: "row_identity_conflict" });
      }
      const first = Math.max(2, sheet.getLastRow() + 1);
      const last = first + intent.values.length - 1;
      if (last > ND_WB_MAX_ROWS) return wbJson_({ ok: false, error: "sheet_bounds" });
      if (last > sheet.getMaxRows()) requests.push({ appendDimension: { sheetId: sheet.getSheetId(), dimension: "ROWS", length: last - sheet.getMaxRows() } });
      for (let i = 0; i < intent.values.length; i++) {
        const value = intent.values[i];
        const keys = Object.keys(value);
        if (!keys.some((name) => columns.includes(name)) || keys.some((name) => name !== "ND Row ID" && !columns.includes(name))) {
          return wbJson_({ ok: false, error: "column_not_allowed" });
        }
        rows.push(first + i);
        keys.forEach((name) => cell(first + i, name, value[name]));
        cell(first + i, "ND Revision", "1");
      }
    } else {
      const id = intent.rowRef.slice(3);
      const matches = ids.map((value, i) => value === id ? i : -1).filter((i) => i >= 0);
      const value = intent.values[0];
      const expected = value.__expected_revision;
      const keys = Object.keys(value).filter((name) => name !== "__expected_revision");
      if (matches.length !== 1) return wbJson_({ ok: false, error: "row_identity_conflict" });
      if (!/^[1-9][0-9]{0,8}$/.test(expected || "") || revisions[matches[0]] !== expected) return wbJson_({ ok: false, error: "revision_conflict" });
      if (!keys.length || keys.some((name) => !columns.includes(name))) return wbJson_({ ok: false, error: "column_not_allowed" });
      rows = [matches[0] + 2]; // Locate by stable ID after row moves; never trust A2.
      keys.forEach((name) => cell(rows[0], name, value[name]));
      cell(rows[0], "ND Revision", String(Number(expected) + 1));
    }
    const receipt = { version: ND_WRITEBACK_VERSION, organizationId: org, operationId: body.operationId,
      intentHash: body.intentHash, tab: intent.tab, rowCount: rows.length, committedAt: new Date().toISOString() };
    requests.push({ createDeveloperMetadata: { developerMetadata: { metadataKey: key, metadataValue: JSON.stringify(receipt),
      visibility: "DOCUMENT", location: { spreadsheet: true } } } });
    // The receipt and all cell changes commit atomically. A network timeout can be
    // resolved by lookup/replay of this exact operation, never a fresh append ID.
    Sheets.Spreadsheets.batchUpdate({ requests: requests, includeSpreadsheetInResponse: false }, sheetId);
    const confirmed = wbReceipt_(sheetId, key);
    if (!confirmed || wbCanonical_(confirmed) !== wbCanonical_(receipt)) return wbJson_({ ok: false, error: "unconfirmed" });
    return wbJson_({ ok: true, receipt: confirmed });
  } catch (_error) {
    return wbJson_({ ok: false, error: "unconfirmed" }); // No raw Google errors, token or cells.
  } finally { if (lock) lock.releaseLock(); }
}

function wbReceipt_(sheetId, key) {
  const result = Sheets.Spreadsheets.DeveloperMetadata.search({ dataFilters: [{ developerMetadataLookup: {
    metadataKey: key, visibility: "DOCUMENT", locationType: "SPREADSHEET" } }] }, sheetId);
  const matches = result.matchedDeveloperMetadata || [];
  if (matches.length > 1) throw new Error("Duplicate receipt metadata");
  return matches.length ? JSON.parse(matches[0].developerMetadata.metadataValue) : null;
}
function wbValidIntent_(intent) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent) || Object.keys(intent).sort().join(",") !== "action,rowRef,tab,values" ||
      !["append", "update_cells"].includes(intent.action) || !["Auto Posting", "Auto Listing"].includes(intent.tab) ||
      !Array.isArray(intent.values) || !intent.values.length || intent.values.length > 50) return false;
  if (intent.action === "append" ? intent.rowRef !== null : (typeof intent.rowRef !== "string" ||
      !intent.rowRef.startsWith("id:") || !ND_WB_UUID.test(intent.rowRef.slice(3)) || intent.values.length !== 1)) return false;
  return intent.values.every((row) => row && typeof row === "object" && !Array.isArray(row) && Object.keys(row).length > 0 &&
    Object.keys(row).length <= 100 && Object.keys(row).every((key) => ["ND Row ID", "__expected_revision"].concat(ND_WB_SAFE_COLUMNS).includes(key) &&
      (row[key] === null || (typeof row[key] === "string" && Array.from(row[key]).length <= 4000 && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(row[key]))))) &&
    Utilities.newBlob(wbCanonical_(intent)).getBytes().length <= 65536;
}
function wbCanonical_(value) {
  if (Array.isArray(value)) return "[" + value.map(wbCanonical_).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + wbCanonical_(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function wbHash_(intent) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, wbCanonical_(intent), Utilities.Charset.UTF_8)
    .map((b) => (b & 255).toString(16).padStart(2, "0")).join("");
}
function wbEqual_(a, b) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}
function wbJson_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
