/**
 * ND Automations — READ-ONLY reporting sync.
 *
 * A STANDALONE Apps Script project, separate from the script the desktop tool
 * uses. Deploying this does not change the existing automation in any way.
 *
 * What it does: getPostRecords returns Profile Name, Post link, Status and a
 * short title for Auto Posting / Auto Listing. The additive getTaskRows action
 * provides the same safe metadata projection for the desktop task tabs below.
 * The additive getMasterLayout action only inspects structure — tab names,
 * sizes, the detected header row and recognised column labels — so a workbook
 * with its own layout can be mapped without guessing. It returns no cell text
 * for a label it does not already recognise.
 * The additive getMasterSections action reads a tab as dated sections (banner in
 * column A, repeated header row, rows beneath) and returns only the mapped safe
 * fields: Account/Profile Name, an exact Nextdoor link, status, a one-line title,
 * service, area and state. It never reads phone, pictures, remarks or credential
 * columns, and it refuses to guess the link column.
 * What it never does:
 *   - write to the sheet (it only calls read methods);
 *   - read the Email, Password, Proxy, Cookies or any other column for data —
 *     only the four columns below are ever fetched as data;
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
// A separate metadata-only action supports the familiar desktop tabs. It never
// reads credential, cookie, proxy, address or media columns, even for these tabs.
const TASK_TABS = {
  "Auto Posting": { titleHeader: "Post Text" },
  "Auto Listing": { titleHeader: "Title" },
  "Incog Profile Creation": { titleHeader: "" },
  "ND Acc Creation": { titleHeader: "" },
  "Bulk cookies import": { titleHeader: "", alias: "Bulk proxy import" },
  "Bulk proxies import": { titleHeader: "" },
  "Auto Warmup": { titleHeader: "" },
  "Auto Random Posting": { titleHeader: "" }
};
const MAX_ROWS = 2000;
const TITLE_MAX = 120;

// Layout discovery is structure-only. Column labels are matched against this
// allowlist, so an unrecognised header cell's text never leaves the workbook.
const LAYOUT_MAX_TABS = 30;
const LAYOUT_MAX_COLUMNS = 40;
const LAYOUT_SCAN_ROWS = 6;

// Sectioned workbook reading (date banner + repeated header rows).
const SECTION_SCAN_ROWS = 4000;
const SECTION_MAX_SECTIONS = 8;
const SECTION_MAX_RETURNED = 2400;
const SECTION_TITLE_MAX = 120;
// Canonical field <- header label, with a priority so a better label wins.
const SECTION_HEADERS = {
  "account name": ["profile", 1],
  "profile name": ["profile", 2],
  "post status": ["status", 1],
  "status": ["status", 2],
  "post link": ["link", 1],
  "nextdoor link": ["link", 1],
  "nextdoor post link": ["link", 1],
  "post url": ["link", 1],
  "link": ["link", 2],
  "final rephrasing": ["title", 1],
  "post text": ["title", 1],
  "title": ["title", 1],
  "content": ["title", 2],
  "services fudge": ["service", 1],
  "services": ["service", 2],
  "areas": ["area", 1],
  "area": ["area", 2],
  "state": ["state", 1]
};
const LABEL_ALIASES = {
  "profile name": "profile name",
  "profile": "profile name",
  "account name": "account name",
  "account": "account name",
  "services": "services",
  "services fudge": "services",
  "content": "content",
  "post text": "post text",
  "title": "title",
  "final rephrasing": "final rephrasing",
  "date posted": "date posted",
  "posted date": "date posted",
  "post date": "date posted",
  "date": "date posted",
  "post type": "post type",
  "post status": "post status",
  "status": "post status",
  "post link": "post link",
  "nextdoor link": "post link",
  "link": "post link",
  "finding keywords": "keywords",
  "keywords": "keywords",
  "numbers": "phone",
  "phone": "phone",
  "areas": "area",
  "area": "area",
  "state": "state",
  "pictures": "pictures",
  "image": "pictures",
  "images": "pictures",
  "ranking": "ranking",
  "remarks": "remarks",
  "issues": "issues",
  "email": "email",
  "password": "password",
  "cookies": "cookies",
  "proxy": "proxy"
};

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
    const action = String(body.action || "");
    if (action !== "getPostRecords" && action !== "getTaskRows" && action !== "getMasterLayout" && action !== "getMasterSections") return json_({ ok: false, error: "invalid_action" });

    const book = SpreadsheetApp.openById(sheetId);
    if (action === "getMasterLayout") return json_(layout_(book));
    if (action === "getMasterSections") return json_(masterSections_(book, body.sheet, body.linkHeader));

    const tab = String(body.sheet || "Auto Posting");
    const allowed = action === "getTaskRows" ? TASK_TABS : SYNC_TABS;
    if (!Object.prototype.hasOwnProperty.call(allowed, tab)) return json_({ ok: false, error: "invalid_sheet" });

    const sheet = findSheet_(book, tab) || (allowed[tab].alias ? findSheet_(book, allowed[tab].alias) : null);
    if (!sheet) return json_({ ok: false, error: "sheet_not_found" });

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const fetchedAt = new Date().toISOString();
    if (lastRow < 2 || lastCol < 1) return json_({ ok: true, sheet: tab, fetchedAt: fetchedAt, truncated: false, rows: [] });

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const col = function (name) { return headers.indexOf(name.toLowerCase()) + 1; }; // 0 when missing
    const statusCol = col("status");
    if (!statusCol) return json_({ ok: false, error: "status_column_missing" });
    if (action === "getTaskRows" && !col("profile name")) return json_({ ok: false, error: "profile_column_missing" });

    const count = Math.min(lastRow - 1, MAX_ROWS);
    // Read ONLY these columns. Credentials in other columns are never loaded.
    const read = function (c) {
      if (!c) return new Array(count).fill("");
      return sheet.getRange(2, c, count, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); });
    };
    const names = read(col("profile name"));
    const links = read(col("post link"));
    const statuses = read(statusCol);
    const titles = read(allowed[tab].titleHeader ? col(allowed[tab].titleHeader) : 0);

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

// Structure only: sizes, the detected header row and allowlisted labels.
// Header text that is not recognised is counted, never returned.
function layout_(spreadsheet) {
  const all = spreadsheet.getSheets();
  const sheets = all.slice(0, LAYOUT_MAX_TABS);
  const tabs = [];
  for (let i = 0; i < sheets.length; i++) tabs.push(tabLayout_(sheets[i]));
  return {
    ok: true,
    action: "getMasterLayout",
    fetchedAt: new Date().toISOString(),
    tabCount: all.length,
    truncated: all.length > LAYOUT_MAX_TABS,
    tabs: tabs
  };
}

function tabLayout_(sheet) {
  const rows = sheet.getLastRow();
  const columns = sheet.getLastColumn();
  const tab = { name: String(sheet.getName()).trim().slice(0, 40), rows: rows, columns: columns, headerRow: 0, planDate: null, labels: [], unrecognisedHeaders: 0 };
  if (rows < 1 || columns < 1) return tab;

  const width = Math.min(columns, LAYOUT_MAX_COLUMNS);
  const height = Math.min(rows, LAYOUT_SCAN_ROWS);
  const block = sheet.getRange(1, 1, height, width).getDisplayValues();

  let bestRow = -1;
  let bestScore = 0;
  for (let r = 0; r < block.length; r++) {
    const score = labelScore_(block[r]);
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }
  if (bestScore < 2) return tab;

  tab.headerRow = bestRow + 1;
  const headerRow = block[bestRow];
  for (let c = 0; c < width; c++) {
    const raw = String(headerRow[c] === null || headerRow[c] === undefined ? "" : headerRow[c]).trim();
    if (!raw) continue;
    const label = label_(raw);
    if (label) tab.labels.push({ column: columnName_(c + 1), label: label });
    else tab.unrecognisedHeaders += 1;
  }
  if (bestRow > 0) tab.planDate = planDate_(block[0][0]);
  return tab;
}

function labelScore_(row) {
  let score = 0;
  for (let c = 0; c < row.length; c++) if (label_(row[c])) score++;
  return score;
}

function label_(value) {
  const key = String(value === null || value === undefined ? "" : value).replace(/\s+/g, " ").trim().toLowerCase();
  if (!key || key.length > 40) return null;
  return Object.prototype.hasOwnProperty.call(LABEL_ALIASES, key) ? LABEL_ALIASES[key] : null;
}

// Reads a calendar date from a banner cell. Never treated as a publication time.
function planDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return isoDate_(value);
  const text = String(value === null || value === undefined ? "" : value).trim();
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!us) return null;
  const month = Number(us[1]);
  const day = Number(us[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return us[3] + "-" + pad2_(month) + "-" + pad2_(day);
}

function isoDate_(date) {
  return date.getFullYear() + "-" + pad2_(date.getMonth() + 1) + "-" + pad2_(date.getDate());
}

function pad2_(n) {
  return n < 10 ? "0" + n : String(n);
}

function columnName_(index) {
  let name = "";
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Reads one tab as dated sections: a date banner, a header row, then rows.
// Only mapped columns are fetched — never phone, pictures, remarks, email,
// password, cookies or proxy — and a link is returned only when it is an exact
// Nextdoor share URL. A link column is never guessed from data; it must be
// declared or carry a recognised header.
function masterSections_(spreadsheet, tabName, linkHeader) {
  const tab = String(tabName === null || tabName === undefined ? "" : tabName).trim().slice(0, 100);
  if (!tab) return { ok: false, error: "invalid_sheet" };
  const sheet = findSheet_(spreadsheet, tab);
  if (!sheet) return { ok: false, error: "sheet_not_found" };

  const declared = String(linkHeader === null || linkHeader === undefined ? "" : linkHeader).replace(/\s+/g, " ").trim().slice(0, 60);
  const fetchedAt = new Date().toISOString();
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return { ok: true, action: "getMasterSections", sheet: tab, fetchedAt: fetchedAt, linkHeader: declared || null, linkColumnSource: null, columns: {}, sections: [], warnings: ["empty_sheet"], truncated: false, returnedRows: 0 };
  }

  const width = Math.min(lastColumn, LAYOUT_MAX_COLUMNS);
  const scanRows = Math.min(lastRow, SECTION_SCAN_ROWS);
  const firstColumn = sheet.getRange(1, 1, scanRows, 1).getDisplayValues();

  const ranges = [];
  let banner = null;
  let open = null;
  let declaredSeen = false;

  for (let r = 0; r < scanRows && ranges.length < SECTION_MAX_SECTIONS; r++) {
    const rowNumber = r + 1;
    const first = String(firstColumn[r][0] === null || firstColumn[r][0] === undefined ? "" : firstColumn[r][0]).trim();
    const date = planDate_(first);
    if (date) {
      if (open) { open.toRow = rowNumber - 1; ranges.push(open); open = null; }
      banner = { date: date, row: rowNumber };
      continue;
    }
    if (!/^services(\s+fudge)?$/i.test(first) && !/(profile|account)\s*name/i.test(first)) continue;

    const headerRow = sheet.getRange(rowNumber, 1, 1, width).getDisplayValues()[0];
    const mapped = mapSectionColumns_(headerRow, declared);
    if (mapped.declaredSeen) declaredSeen = true;
    if (Object.keys(mapped.columns).length < 2) continue;
    if (open) { open.toRow = rowNumber - 1; ranges.push(open); }
    open = {
      planDate: banner ? banner.date : null,
      bannerRow: banner ? banner.row : null,
      headerRow: rowNumber,
      fromRow: rowNumber + 1,
      toRow: scanRows,
      columns: mapped.columns
    };
    banner = null;
  }
  if (open && ranges.length < SECTION_MAX_SECTIONS) { open.toRow = scanRows; ranges.push(open); }

  const sections = [];
  let returned = 0;
  let truncated = scanRows < lastRow;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const span = range.toRow - range.fromRow + 1;
    if (span < 1) continue;
    const room = SECTION_MAX_RETURNED - returned;
    if (room < 1) { truncated = true; break; }
    const take = Math.min(span, room);
    const section = readSection_(sheet, range, take);
    if (take < span) { section.truncated = true; truncated = true; }
    returned += section.rows.length;
    sections.push(section);
  }

  const columns = sections.length > 0 ? sections[0].columns : {};
  const warnings = [];
  if (ranges.length === 0) warnings.push("no_sections_detected");
  if (!columns.profile) warnings.push("profile_column_missing");
  if (!columns.link) warnings.push("link_column_missing");
  if (declared && !declaredSeen) warnings.push("link_header_not_found");
  for (let i = 0; i < sections.length; i++) {
    if (!sections[i].planDate) { warnings.push("section_without_banner"); break; }
  }

  return {
    ok: true,
    action: "getMasterSections",
    sheet: tab,
    fetchedAt: fetchedAt,
    linkHeader: declared || null,
    linkColumnSource: !columns.link ? null : (declared && declaredSeen ? "declared" : "header"),
    columns: columns,
    sections: sections,
    warnings: warnings,
    truncated: truncated,
    returnedRows: returned
  };
}

function readSection_(sheet, range, count) {
  const keys = ["profile", "link", "status", "title", "service", "area", "state"];
  const values = {};
  for (let i = 0; i < keys.length; i++) {
    const column = range.columns[keys[i]] || 0;
    values[keys[i]] = column ? sheet.getRange(range.fromRow, column, count, 1).getDisplayValues() : [];
  }

  const rows = [];
  let rejectedLinks = 0;
  for (let i = 0; i < count; i++) {
    const profile = cell_(values.profile, i).slice(0, 120);
    const rawLink = cell_(values.link, i);
    const link = nextdoorLink_(rawLink);
    if (rawLink && !link) rejectedLinks += 1;
    const status = cell_(values.status, i).slice(0, 300);
    const title = firstLine_(cell_(values.title, i)).slice(0, SECTION_TITLE_MAX);
    const service = cell_(values.service, i).slice(0, 120);
    const area = cell_(values.area, i).slice(0, 80);
    const state = cell_(values.state, i).slice(0, 80);
    if (!profile && !link && !status && !title && !service && !area && !state) continue;
    rows.push({
      rowNumber: range.fromRow + i,
      profileName: profile,
      postLink: link,
      status: status,
      title: title,
      service: service,
      area: area,
      state: state
    });
  }

  return {
    planDate: range.planDate,
    bannerRow: range.bannerRow,
    headerRow: range.headerRow,
    fromRow: range.fromRow,
    toRow: range.toRow,
    columns: columnLetters_(range.columns),
    rows: rows,
    rejectedLinks: rejectedLinks
  };
}

function mapSectionColumns_(headerRow, declared) {
  const columns = {};
  const rank = {};
  let declaredSeen = false;
  const wanted = declared ? declared.toLowerCase() : "";
  for (let c = 0; c < headerRow.length; c++) {
    const label = String(headerRow[c] === null || headerRow[c] === undefined ? "" : headerRow[c]).replace(/\s+/g, " ").trim().toLowerCase();
    if (!label) continue;
    if (wanted && label === wanted) {
      declaredSeen = true;
      columns.link = c + 1;
      rank.link = 0;
      continue;
    }
    const target = SECTION_HEADERS[label];
    if (!target) continue;
    if (!columns[target[0]] || target[1] < rank[target[0]]) {
      columns[target[0]] = c + 1;
      rank[target[0]] = target[1];
    }
  }
  return { columns: columns, declaredSeen: declaredSeen };
}

// Only exact Nextdoor share links are returned; a query string is allowed but
// stripped, and anything else is refused rather than passed to a browser.
function nextdoorLink_(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  const match = text.match(/^https:\/\/(www\.)?(nextdoor\.com|nextdoor\.co\.uk)\/(p|for_sale_and_free)\/([A-Za-z0-9_-]+)\/?(?:[?#][^\s]*)?$/i);
  if (!match) return "";
  return "https://" + (match[1] ? "www." : "") + match[2].toLowerCase() + "/" + match[3] + "/" + match[4];
}

function cell_(values, index) {
  const row = values[index];
  if (!row) return "";
  return String(row[0] === null || row[0] === undefined ? "" : row[0]).trim();
}

function columnLetters_(columns) {
  const out = {};
  for (const key in columns) {
    if (columns[key]) out[key] = columnName_(columns[key]);
  }
  return out;
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
