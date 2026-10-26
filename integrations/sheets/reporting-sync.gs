/**
 * ND Automations — READ-ONLY reporting sync.
 *
 * A STANDALONE Apps Script project, separate from the script the desktop tool
 * uses. Deploying this does not change the existing automation in any way.
 *
 * What it does:  returns Profile Name, Post link, Status and a short title for
 *                each row of the "Auto Posting" or "Auto Listing" tab.
 * What it never does:
 *   - write to the sheet (it only calls read methods);
 *   - read the Email, Password, Proxy, Cookies or any other column — only the
 *     four columns below are ever fetched from the sheet;
 *   - accept a request without the secret token.
 *
 * Setup: see integrations/sheets/README.md
 * Script properties required (Project Settings > Script properties):
 *   SHEET_ID    the long id in your Google Sheet URL
 *   SYNC_TOKEN  a random secret of 24+ characters (also saved in the dashboard's .env.local)
 */

const SYNC_TABS = {
  "Auto Posting": { titleHeader: "Post Text" },
  "Auto Listing": { titleHeader: "Title" }
};
const MAX_ROWS = 2000;
const TITLE_MAX = 120;

function doGet() {
  return json_({ ok: false, error: "post_only" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty("SYNC_TOKEN");
    const sheetId = props.getProperty("SHEET_ID");

    if (!expected || expected.length < 24 || !sheetId) return json_({ ok: false, error: "not_configured" });
    if (!safeEqual_(String(body.token || ""), expected)) return json_({ ok: false, error: "unauthorized" });
    if (body.action !== "getPostRecords") return json_({ ok: false, error: "invalid_action" });

    const tab = String(body.sheet || "Auto Posting");
    if (!Object.prototype.hasOwnProperty.call(SYNC_TABS, tab)) return json_({ ok: false, error: "invalid_sheet" });

    const sheet = findSheet_(SpreadsheetApp.openById(sheetId), tab);
    if (!sheet) return json_({ ok: false, error: "sheet_not_found" });

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const fetchedAt = new Date().toISOString();
    if (lastRow < 2 || lastCol < 1) return json_({ ok: true, sheet: tab, fetchedAt: fetchedAt, truncated: false, rows: [] });

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const col = function (name) { return headers.indexOf(name.toLowerCase()) + 1; }; // 0 when missing
    const statusCol = col("status");
    if (!statusCol) return json_({ ok: false, error: "status_column_missing" });

    const count = Math.min(lastRow - 1, MAX_ROWS);
    // Read ONLY these columns. Credentials in other columns are never loaded.
    const read = function (c) {
      if (!c) return new Array(count).fill("");
      return sheet.getRange(2, c, count, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); });
    };
    const names = read(col("profile name"));
    const links = read(col("post link"));
    const statuses = read(statusCol);
    const titles = read(col(SYNC_TABS[tab].titleHeader));

    const rows = [];
    for (let i = 0; i < count; i++) {
      if (!names[i] && !links[i] && !statuses[i]) continue;
      rows.push({
        rowNumber: i + 2,
        profileName: names[i].slice(0, 120),
        title: firstLine_(titles[i]).slice(0, TITLE_MAX),
        postLink: links[i].slice(0, 500),
        status: statuses[i].slice(0, 300)
      });
    }
    return json_({ ok: true, sheet: tab, fetchedAt: fetchedAt, truncated: lastRow - 1 > MAX_ROWS, rows: rows });
  } catch (err) {
    return json_({ ok: false, error: "server_error" });
  }
}

function findSheet_(spreadsheet, name) {
  const direct = spreadsheet.getSheetByName(name);
  if (direct) return direct;
  const wanted = name.toLowerCase();
  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === wanted) return sheets[i];
  }
  return null;
}

function firstLine_(text) {
  return String(text || "").split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
}

// Compares without stopping at the first difference.
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
