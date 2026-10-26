import { needsCheck, outcomeInfo } from "./checks";
import { isStale } from "./time";
import type { Publication } from "./types";
import { safeCsvCell, type Visibility } from "./validation";

export const EXPORT_SCOPES = ["all", "needs_check", "issues"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

// Headers reuse the sheet's own names (Profile Name, Post link) so an export can be matched to sheet rows and
// loaded back through the same importer.
export const EXPORT_HEADERS = ["Customer", "Profile Name", "Title", "Post link", "Status update", "Dashboard status", "Last check result", "Last checked (UTC)", "Last observed (UTC)", "Comments seen", "Source", "Recorded (UTC)"] as const;

// Only the verification scenarios the sheet already uses are written to "Status update". Everything else is left
// blank on purpose, and the detail stays in "Last check result", so no new status wording is invented for the sheet.
export function sheetStatusUpdate(outcome: string | null | undefined, visibility: Visibility): string {
  if (outcome === "alive") return "Alive";
  if (outcome === "deleted_from_nd") return "Post Deleted from ND";
  if (outcome === "proxy_issue") return "Proxy Issue";
  if (outcome) return "";
  if (visibility === "live") return "Alive";
  if (visibility === "confirmed_removed") return "Post Deleted from ND";
  return "";
}

const isIssue = (post: Publication) => {
  const tone = outcomeInfo(post.last_check_outcome)?.tone;
  return tone === "negative" || tone === "attention" || ["unavailable", "confirmed_removed", "deleted_by_owner", "unknown"].includes(post.visibility);
};

export function exportRows(posts: Publication[], customerNames: Map<string, string>, visibilityLabels: Record<Visibility, string>, options: { scope?: ExportScope; customerId?: string; now?: Date } = {}): (string | number | null)[][] {
  const { scope = "all", customerId, now = new Date() } = options;
  const selected = posts.filter((post) => {
    if (customerId && post.customer_id !== customerId) return false;
    if (scope === "needs_check") return needsCheck(post, isStale(post.last_observed_at, now));
    if (scope === "issues") return isIssue(post);
    return true;
  });
  return [
    [...EXPORT_HEADERS],
    ...selected.map((post) => [
      customerNames.get(post.customer_id) ?? "Assigned customer", post.account_label, post.title, post.url,
      sheetStatusUpdate(post.last_check_outcome, post.visibility), visibilityLabels[post.visibility],
      outcomeInfo(post.last_check_outcome)?.label ?? "", post.last_checked_at ?? null, post.last_observed_at, post.comments_total, post.source === "sheet_import" ? "Sheet import" : "Manual entry", post.created_at,
    ]),
  ];
}

export function toCsv(rows: (string | number | null)[][]): string {
  return `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}\r\n`;
}
