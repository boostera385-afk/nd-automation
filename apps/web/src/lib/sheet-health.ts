import { classifyStatus, validPostUrl, type SheetRow } from "./sheet-status";
import { safeCsvCell } from "./validation";

export type Severity = "high" | "medium" | "low";
export type HealthCode = "reprocess_risk" | "posted_no_link" | "posted_bad_link" | "duplicate_link" | "failed_with_link" | "claimed" | "failed" | "failed_retryable" | "sheet_deleted" | "sheet_proxy_issue" | "missing_profile" | "unrecognised_status" | "nonstandard_wording";
export type HealthRow = { rowNumber: number; profileName: string; note: string };
export type HealthIssue = { code: HealthCode; severity: Severity; title: string; why: string; fix: string; total: number; rows: HealthRow[] };
export type HealthReport = { totalRows: number; rowsNeedingAction: number; cleanRows: number; issues: HealthIssue[] };

export const MAX_HEALTH_ROWS = 500;

const definitions: Record<HealthCode, { severity: Severity; title: string; why: string; fix: string }> = {
  reprocess_risk: { severity: "high", title: "Link filled in but Status is empty", why: "Whatever automation fills this Sheet treats an empty Status as “not posted yet”, so it may post this row again.", fix: "If it was really posted, set Status to Posted. Otherwise clear the Post link." },
  posted_no_link: { severity: "high", title: "Marked Posted but no link saved", why: "Without the exact link the post cannot be checked or reported on.", fix: "Find the post on Nextdoor and paste its own share link into Post link." },
  posted_bad_link: { severity: "high", title: "Post link is not an exact Nextdoor share link", why: "Profile pages, shortened or edited links cannot be matched to one post.", fix: "Replace it with the post’s own link (nextdoor.com/p/… or /for_sale_and_free/…)." },
  duplicate_link: { severity: "medium", title: "Same link on more than one row", why: "One post would be counted more than once in reports.", fix: "Keep one row for the post; correct or clear the others." },
  failed_with_link: { severity: "medium", title: "Failed, but a link exists", why: "Status and link disagree: the post may actually have gone out.", fix: "Open the link. If the post is live set Status to Posted; otherwise clear the link." },
  claimed: { severity: "medium", title: "Row still marked CLAIMED", why: "CLAIMED means a run is working on it. If no run is active it was interrupted and will not finish on its own.", fix: "Confirm no run is active, then clear Status to retry or enter the real result." },
  failed: { severity: "medium", title: "Failed or stopped rows", why: "These are not published posts and need a decision.", fix: "Fix the cause and clear Status to retry, or leave as failed on purpose." },
  failed_retryable: { severity: "medium", title: "Failed after all retries", why: "A temporary problem lasted through every attempt (for example the profile would not start).", fix: "Check the profile and proxy, then clear Status to retry." },
  sheet_deleted: { severity: "medium", title: "Marked as deleted from Nextdoor", why: "These posts are no longer live, so reports must show them as removed, but only with evidence.", fix: "Confirm Nextdoor showed a removal message, then record it in the dashboard with that evidence." },
  sheet_proxy_issue: { severity: "medium", title: "Proxy issue flagged", why: "The check could not be completed. This says nothing about whether the post is still live.", fix: "Fix or replace the proxy, check the post again, then update Status to the real result." },
  missing_profile: { severity: "medium", title: "Row has no Profile Name", why: "The account that made this post cannot be identified.", fix: "Fill in the Profile Name." },
  unrecognised_status: { severity: "low", title: "Status wording not recognised", why: "The dashboard cannot tell what this status means.", fix: "Use the standard wording: Posted, Failed: …, or leave empty." },
  nonstandard_wording: { severity: "low", title: "Status wording differs from the standard", why: "The dashboard understands it, but other tools may not (for example “posted” instead of “Posted”).", fix: "Retype it with the standard capitalisation." },
};

const severityOrder: Severity[] = ["high", "medium", "low"];
const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function buildHealthReport(rows: SheetRow[]): HealthReport {
  const found = new Map<HealthCode, HealthRow[]>();
  const totals = new Map<HealthCode, number>();
  const actionRows = new Set<number>();
  const add = (code: HealthCode, row: SheetRow, note = "") => {
    totals.set(code, (totals.get(code) ?? 0) + 1);
    const list = found.get(code) ?? [];
    if (list.length < MAX_HEALTH_ROWS) list.push({ rowNumber: row.rowNumber, profileName: row.profileName.trim(), note });
    found.set(code, list);
    if (definitions[code].severity !== "low") actionRows.add(row.rowNumber);
  };

  const byUrl = new Map<string, SheetRow[]>();
  for (const row of rows) {
    const status = row.status.trim();
    const link = row.postLink.trim();
    const kind = classifyStatus(status, link);
    const url = validPostUrl(link);
    if (url) byUrl.set(url, [...(byUrl.get(url) ?? []), row]);

    if (kind === "pending" && link) add("reprocess_risk", row, status ? `Status “${status}”` : "Status empty");
    if (kind === "posted_no_link") add("posted_no_link", row);
    if (kind === "posted_bad_link") add("posted_bad_link", row, `Cell contains: ${short(link, 60)}`);
    if (kind === "claimed") add("claimed", row);
    if (kind === "failed" || kind === "stopped") add("failed", row, short(status, 80));
    if (kind === "failed_retryable") add("failed_retryable", row, short(status, 80));
    if ((kind === "failed" || kind === "failed_retryable" || kind === "stopped") && link) add("failed_with_link", row, status ? short(status, 60) : "");
    if (kind === "deleted") add("sheet_deleted", row, short(status, 80));
    if (kind === "proxy_issue") add("sheet_proxy_issue", row, short(status, 80));
    if (kind === "other") add("unrecognised_status", row, short(status, 80));
    if (!row.profileName.trim() && (status || link)) add("missing_profile", row);

    const standard = kind === "claimed" ? status === "CLAIMED"
      : kind === "posted" || kind === "posted_no_link" || kind === "posted_bad_link" ? status.startsWith("Posted")
      : kind === "failed" || kind === "failed_retryable" || kind === "stopped" ? status.startsWith("Failed")
      : true;
    if (!standard) add("nonstandard_wording", row, `“${short(status, 40)}”`);
  }

  for (const group of byUrl.values()) {
    if (group.length < 2) continue;
    for (const row of group) add("duplicate_link", row, `Link also on row ${group.filter((other) => other !== row).map((other) => other.rowNumber).join(", ")}`);
  }

  const issues: HealthIssue[] = [];
  for (const severity of severityOrder) {
    for (const code of Object.keys(definitions) as HealthCode[]) {
      const total = totals.get(code) ?? 0;
      if (definitions[code].severity !== severity || total === 0) continue;
      const rowsForCode = [...(found.get(code) ?? [])].sort((a, b) => a.rowNumber - b.rowNumber);
      issues.push({ code, ...definitions[code], total, rows: rowsForCode });
    }
  }
  return { totalRows: rows.length, rowsNeedingAction: actionRows.size, cleanRows: rows.length - actionRows.size, issues };
}

// Handover file for whoever cleans the sheet. Cells are escaped against spreadsheet formula injection.
export function healthToCsv(report: HealthReport, sheet: string): string {
  const header = ["Sheet tab", "Row in sheet", "Profile", "Severity", "Issue", "Detail", "How to fix"];
  const lines = [header.map(safeCsvCell).join(",")];
  for (const issue of report.issues) {
    for (const row of issue.rows) lines.push([sheet, row.rowNumber, row.profileName, issue.severity, issue.title, row.note, issue.fix].map(safeCsvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
