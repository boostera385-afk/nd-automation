/**
 * Google Apps Script for Automation Tool Integration (DYNAMIC VERSION)
 *
 * INSTRUCTIONS:
 * 1. Open your Google Sheet.
 * 2. Click on "Extensions" > "Apps Script".
 * 3. Delete any code in the editor and paste this entire script.
 * 4. Run "setupSheets" once (or use the "Automation" menu that appears in the
 *    sheet after a reload) to create every tab with the right headers.
 * 5. Click the "Deploy" button (top right) > "New deployment" (or "Manage deployments" -> Edit -> New version).
 * 6. Select type "Web app".
 * 7. Set "Execute as" to "Me".
 * 8. Set "Who has access" to "Anyone".
 * 9. Click "Deploy" (you may need to authorize permissions).
 * 10. Copy the generated "Web app URL" and save it in the Desktop App Settings.
 */

const SHEET_PROFILES = "Incog Profile Creation";
const SHEET_ND_ACC = "ND Acc Creation";
const SHEET_BULK_COOKIES = "Bulk cookies import";
const SHEET_BULK_PROXIES = "Bulk proxies import";

// The cookie tab used to be misnamed "Bulk proxy import"; setupSheets renames
// it, and lookups still fall back to it so older sheets keep working.
const LEGACY_COOKIE_SHEET = "Bulk proxy import";

// Every tab the desktop app talks to, with the headers it expects.
const SHEET_DEFINITIONS = [
  { name: SHEET_PROFILES, headers: ["ID", "Profile Name", "Group", "Proxy", "Lat/Long", "Status"] },
  { name: SHEET_ND_ACC, headers: ["ID", "Profile Name", "Full Name", "Email", "Password", "Status"] },
  { name: SHEET_BULK_COOKIES, headers: ["Profile Name", "Cookies", "Status"] },
  { name: SHEET_BULK_PROXIES, headers: ["Profile Name", "Proxy", "Status"] },
  { name: "Auto Posting", headers: [] },
  { name: "Auto Listing", headers: [] },
  { name: "Auto Warmup", headers: [] },
  { name: "Auto Random Posting", headers: [] }
];

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Automation")
      .addItem("Create / repair sheets", "setupSheets")
      .addToUi();
  } catch (err) {
    // onOpen also runs in contexts without a UI - ignore.
  }
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  renameLegacyCookieSheet_();

  SHEET_DEFINITIONS.forEach(def => {
    let sheet = getSheet_(def.name);

    if (!sheet) {
      sheet = ss.insertSheet(def.name);
      if (def.headers.length > 0) {
        sheet.appendRow(def.headers);
        sheet.getRange(1, 1, 1, def.headers.length).setFontWeight("bold");
        sheet.setFrozenRows(1);
      }
      return;
    }

    // Sheet exists: add any header that is missing instead of touching data.
    if (def.headers.length === 0) return;

    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(h => h.toString().trim());
    const existingLower = existing.map(h => h.toLowerCase());

    // Append after the last non-empty header so nothing gets overwritten.
    let nextCol = 0;
    for (let i = 0; i < existing.length; i++) {
      if (existing[i] !== "") nextCol = i + 1;
    }
    def.headers.forEach(header => {
      if (existingLower.indexOf(header.toLowerCase()) === -1) {
        nextCol += 1;
        sheet.getRange(1, nextCol).setValue(header).setFontWeight("bold");
      }
    });
    sheet.setFrozenRows(1);
  });

  // The cookie column holds long JSON blobs - keep the tab readable.
  const cookieSheet = getSheet_(SHEET_BULK_COOKIES);
  if (cookieSheet) {
    cookieSheet.setColumnWidth(1, 220);
    cookieSheet.setColumnWidth(2, 420);
    cookieSheet.setColumnWidth(3, 260);
  }

  const proxySheet = getSheet_(SHEET_BULK_PROXIES);
  if (proxySheet) {
    proxySheet.setColumnWidth(1, 220);
    proxySheet.setColumnWidth(2, 260);
    proxySheet.setColumnWidth(3, 260);
  }
}

/**
 * Renames the mis-named cookie tab ("Bulk proxy import") to
 * "Bulk cookies import", but only when it really is the cookie tab and the
 * correctly named one does not exist yet. Data is untouched.
 */
function renameLegacyCookieSheet_() {
  const legacy = findSheetByName_(LEGACY_COOKIE_SHEET);
  if (!legacy) return false;
  if (findSheetByName_(SHEET_BULK_COOKIES)) return false;

  const lastCol = Math.max(legacy.getLastColumn(), 1);
  const headers = legacy.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => h.toString().trim().toLowerCase());
  if (headers.indexOf("cookies") === -1) return false;

  legacy.setName(SHEET_BULK_COOKIES);
  return true;
}

/** Case-insensitive sheet lookup with no alias handling. */
function findSheetByName_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!sheetName) return null;

  const direct = ss.getSheetByName(sheetName);
  if (direct) return direct;

  const wanted = sheetName.toString().trim().toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toString().trim().toLowerCase() === wanted) {
      return sheets[i];
    }
  }
  return null;
}

/**
 * Case-insensitive sheet lookup, so "bulk cookies import" also works.
 * Falls back to the old cookie tab name for sheets that were never renamed.
 */
function getSheet_(sheetName) {
  const found = findSheetByName_(sheetName);
  if (found) return found;

  const wanted = (sheetName || "").toString().trim().toLowerCase();
  if (wanted === SHEET_BULK_COOKIES.toLowerCase()) {
    return findSheetByName_(LEGACY_COOKIE_SHEET);
  }
  return null;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = e.parameter.action;

  if (action === "getPendingProfiles") {
    const sheet = getSheet_(SHEET_PROFILES);
    if (!sheet) return jsonOut_({error: "Sheet not found"});

    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    if (data.length < 2) return jsonOut_({success: true, data: []});

    const headers = data[0].map(h => h.toString().trim());
    const pendingProfiles = [];

    // Find status and ID columns
    const statusIdx = headers.findIndex(h => h.toLowerCase() === "status");
    const idIdx = headers.findIndex(h => h.toLowerCase() === "id");

    if (statusIdx === -1) return jsonOut_({error: "Status column not found"});

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[statusIdx].toString().trim() === "") {
        if (isBlankRow_(row)) continue;

        // Auto-generate ID if empty
        if (idIdx !== -1 && row[idIdx] === "") {
           const newId = Utilities.getUuid();
           sheet.getRange(i + 1, idIdx + 1).setValue(newId);
           row[idIdx] = newId;
        }

        // Dynamically map all columns to JSON!
        const profileObj = { rowNumber: i + 1 };
        for (let c = 0; c < headers.length; c++) {
            if (headers[c]) {
                const key = headers[c]; // exact header name
                profileObj[key] = row[c];
            }
        }

        // For backwards compatibility with standard expectations if using separated columns
        profileObj.name = profileObj["Profile Name"] || profileObj["Name"] || "";

        pendingProfiles.push(profileObj);
      }
    }

    return jsonOut_({success: true, data: pendingProfiles});
  }

  if (action === "getPendingNDAccounts") {
    const sheet = getSheet_(SHEET_ND_ACC);
    if (!sheet) return jsonOut_({error: "Sheet not found"});

    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    if (data.length < 2) return jsonOut_({success: true, data: []});

    const headers = data[0].map(h => h.toString().trim());
    const pendingAccounts = [];

    const statusIdx = headers.findIndex(h => h.toLowerCase() === "status");

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (statusIdx !== -1 && row[statusIdx].toString().trim() === "") {
        if (isBlankRow_(row)) continue;

        const accountObj = { rowNumber: i + 1 };
        for (let c = 0; c < headers.length; c++) {
            if (headers[c]) {
                accountObj[headers[c]] = row[c];
            }
        }
        // Force these specifically for ND accounts
        accountObj.id = accountObj["ID"] || "";
        accountObj.profileName = accountObj["Profile Name"] || accountObj["Name"] || "";
        accountObj.fullName = accountObj["Full Name"] || "";
        accountObj.email = accountObj["Email"] || "";
        accountObj.password = accountObj["Password"] || "";

        pendingAccounts.push(accountObj);
      }
    }

    return jsonOut_({success: true, data: pendingAccounts});
  }

  if (action === "getPendingRows") {
    const sheetName = e.parameter.sheetName;
    const sheet = getSheet_(sheetName);
    if (!sheet) return jsonOut_({error: "Sheet not found: " + sheetName});

    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    if (data.length < 2) return jsonOut_({success: true, data: []});

    const headers = data[0].map(h => h.toString().trim());
    const pendingRows = [];

    const statusIdx = headers.findIndex(h => h.toLowerCase() === "status");

    // Rich text is only needed to recover hyperlinks behind picture cells,
    // and reading it is slow - so only fetch it when such a column exists.
    const needsRichText = headers.some(h => {
      const lower = h.toLowerCase();
      return lower.indexOf("picture") !== -1 || lower.indexOf("image") !== -1;
    });
    const richTextData = needsRichText ? dataRange.getRichTextValues() : null;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (statusIdx !== -1 && row[statusIdx].toString().trim() === "") {
        if (isBlankRow_(row)) continue;

        const rowObj = { rowNumber: i + 1 };
        for (let c = 0; c < headers.length; c++) {
            if (headers[c]) {
                let cellVal = row[c];
                const lowerHeader = headers[c].toLowerCase();
                if (richTextData && (lowerHeader.indexOf("picture") !== -1 || lowerHeader.indexOf("image") !== -1)) {
                    const richText = richTextData[i][c];
                    if (richText) {
                        const runs = richText.getRuns();
                        const links = [];
                        for(let r=0; r<runs.length; r++) {
                            const l = runs[r].getLinkUrl();
                            if(l) links.push(l);
                        }
                        if(links.length > 0) {
                            cellVal = links.join(",");
                        }
                    }
                }
                rowObj[headers[c]] = cellVal;
            }
        }

        // Auto-mappings for convenience
        rowObj.id = rowObj["ID"] || rowObj["Profile Name"] || rowObj["Name"] || "";
        rowObj.profileName = rowObj["Profile Name"] || rowObj["Name"] || "";

        pendingRows.push(rowObj);
      }
    }

    return jsonOut_({success: true, data: pendingRows});
  }

  /**
   * Rows waiting for a bulk import (cookies or proxies).
   * A row counts as pending when it has a Profile Name and an empty Status.
   * Params: sheetName, valueColumn (e.g. "Cookies" or "Proxy").
   */
  if (action === "getPendingImportRows" || action === "getPendingCookieImports") {
    const isCookies = action === "getPendingCookieImports" || !e.parameter.valueColumn;
    const sheetName = e.parameter.sheetName || (isCookies ? SHEET_BULK_COOKIES : SHEET_BULK_PROXIES);
    const valueColumn = (e.parameter.valueColumn || "Cookies").toString().trim();

    const sheet = getSheet_(sheetName);
    if (!sheet) return jsonOut_({error: "Sheet not found: " + sheetName});

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return jsonOut_({success: true, data: []});

    const headers = data[0].map(h => h.toString().trim());
    const nameIdx = headers.findIndex(h => h.toLowerCase() === "profile name");
    const valueIdx = headers.findIndex(h => h.toLowerCase() === valueColumn.toLowerCase());
    const statusIdx = headers.findIndex(h => h.toLowerCase() === "status");

    if (nameIdx === -1) return jsonOut_({error: "'Profile Name' column not found on " + sheet.getName()});
    if (valueIdx === -1) return jsonOut_({error: "'" + valueColumn + "' column not found on " + sheet.getName()});
    if (statusIdx === -1) return jsonOut_({error: "'Status' column not found on " + sheet.getName()});

    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const profileName = row[nameIdx].toString().trim();
      const status = row[statusIdx].toString().trim();

      if (!profileName || status !== "") continue;

      const rowObj = { rowNumber: i + 1 };
      for (let c = 0; c < headers.length; c++) {
        if (headers[c]) rowObj[headers[c]] = row[c];
      }
      rowObj.profileName = profileName;
      rowObj.value = row[valueIdx].toString();
      if (valueColumn.toLowerCase() === "cookies") rowObj.cookies = rowObj.value;
      if (valueColumn.toLowerCase() === "proxy") rowObj.proxy = rowObj.value;
      rows.push(rowObj);
    }

    return jsonOut_({success: true, data: rows});
  }

  return jsonOut_({error: "Invalid action"});
}

function isBlankRow_(row) {
  for (let c = 0; c < row.length; c++) {
    if (row[c] !== "" && row[c] !== null && row[c] !== undefined) return false;
  }
  return true;
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === "updateStatus" || action === "updateNDStatus" || action === "updateRowStatus") {
      let targetSheetName = payload.sheetName;
      if (!targetSheetName) {
        targetSheetName = action === "updateStatus" ? SHEET_PROFILES : SHEET_ND_ACC;
      }

      const sheet = getSheet_(targetSheetName);
      if(!sheet) return jsonOut_({error: "Sheet not found: " + targetSheetName});

      const rowNumber = payload.rowNumber;
      const newStatus = payload.status;

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const statusIdx = headers.findIndex(h => h.toString().trim().toLowerCase() === "status");
      if (statusIdx === -1) return jsonOut_({error: "Status column not found"});

      sheet.getRange(rowNumber, statusIdx + 1).setValue(newStatus);

      return jsonOut_({success: true});
    }

    if (action === "updateColumnValue") {
      const targetSheetName = payload.sheetName;
      const rowNumber = payload.rowNumber;
      const columnName = payload.columnName;
      const newValue = payload.value;

      const sheet = getSheet_(targetSheetName);
      if(!sheet) return jsonOut_({error: "Sheet not found: " + targetSheetName});

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const colIdx = headers.findIndex(h => h.toString().trim().toLowerCase() === columnName.toString().toLowerCase());

      if (colIdx !== -1) {
          sheet.getRange(rowNumber, colIdx + 1).setValue(newValue);
          return jsonOut_({success: true});
      } else {
          return jsonOut_({error: "Column not found: " + columnName});
      }
    }

    if (action === "claimRow") {
      const targetSheetName = payload.sheetName;
      const rowNumber = payload.rowNumber;

      const sheet = getSheet_(targetSheetName);
      if(!sheet) return jsonOut_({error: "Sheet not found: " + targetSheetName});

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const statusIdx = headers.findIndex(h => h.toString().trim().toLowerCase() === "status");
      if (statusIdx === -1) return jsonOut_({error: "Status column not found"});

      // Serialize claims so two runs cannot grab the same row.
      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(20000);
      } catch (lockErr) {
        return jsonOut_({success: true, claimed: false, currentStatus: "busy"});
      }

      try {
        const cell = sheet.getRange(rowNumber, statusIdx + 1);
        const currentStatus = cell.getValue().toString().trim().toLowerCase();

        // Atomic claim: only claim if it is currently empty or pending
        if (currentStatus === "" || currentStatus === "pending") {
            cell.setValue("CLAIMED");
            SpreadsheetApp.flush();
            return jsonOut_({success: true, claimed: true});
        }
        return jsonOut_({success: true, claimed: false, currentStatus: currentStatus});
      } finally {
        lock.releaseLock();
      }
    }

    return jsonOut_({error: "Invalid action: " + action});

  } catch(err) {
    return jsonOut_({error: err.message});
  }
}
