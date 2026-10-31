import { z } from "zod";
import { postUrlSchema, type ImportedRow, type Visibility } from "./validation";

export const SHEET_TABS = ["Auto Posting", "Auto Listing"] as const;
export type SheetTab = (typeof SHEET_TABS)[number];

// Strict on purpose: if the endpoint ever returns an extra field (for example a
// Password column from a misconfigured script), the whole response is rejected.
export const sheetRowSchema = z.strictObject({
  rowNumber: z.number().int().min(2).max(1_000_000),
  profileName: z.string().max(200),
  title: z.string().max(300),
  postLink: z.string().max(1000),
  status: z.string().max(1000),
});
export type SheetRow = z.infer<typeof sheetRowSchema>;

export const sheetResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), sheet: z.enum(SHEET_TABS), fetchedAt: z.string().max(40), truncated: z.boolean(), rows: z.array(sheetRowSchema).max(5000) }),
  z.strictObject({ ok: z.literal(false), error: z.string().max(100) }),
]);

export type StatusKind = "pending" | "claimed" | "posted" | "alive" | "deleted" | "proxy_issue" | "posted_no_link" | "posted_bad_link" | "failed" | "failed_retryable" | "stopped" | "other";
export type Tone = "ok" | "warn" | "bad" | "neutral";

export const statusKinds: Record<StatusKind, { label: string; hint: string; tone: Tone }> = {
  pending: { label: "Waiting in queue", hint: "Status is empty; no automation has picked this row up yet.", tone: "neutral" },
  claimed: { label: "In progress or interrupted", hint: "Claimed by an automation run. If it stays like this, a run was probably interrupted.", tone: "warn" },
  posted: { label: "Posted, link saved", hint: "The tool reported a submission and saved a link. Not yet confirmed by a person.", tone: "ok" },
  alive: { label: "Alive (per sheet)", hint: "Someone marked this post Alive in the sheet. The dashboard treats that as a claim until a check is recorded here.", tone: "ok" },
  deleted: { label: "Deleted from Nextdoor (per sheet)", hint: "Someone marked this post as removed from Nextdoor. Confirm it and record the evidence in the dashboard.", tone: "bad" },
  proxy_issue: { label: "Proxy issue (per sheet)", hint: "The check could not be completed because of a proxy problem. This is not evidence about the post.", tone: "warn" },
  posted_no_link: { label: "Posted, no link saved", hint: "Reported as posted but no link was stored, so it cannot be checked later.", tone: "warn" },
  posted_bad_link: { label: "Posted, link not usable", hint: "The Post link cell is not an exact Nextdoor share link.", tone: "warn" },
  failed: { label: "Failed", hint: "The tool gave up on this row. Not a published post.", tone: "bad" },
  failed_retryable: { label: "Failed after retries", hint: "A temporary problem persisted through all attempts. Worth retrying.", tone: "bad" },
  stopped: { label: "Stopped by operator", hint: "The run was stopped manually.", tone: "neutral" },
  other: { label: "Other status", hint: "A status text this dashboard does not recognise.", tone: "warn" },
};

export function validPostUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const result = postUrlSchema.safeParse(text);
  return result.success ? result.data : null;
}

// Mirrors the values the Sheet automation writes (see profile_worker.py) without assuming exact wording.
export function classifyStatus(status: string, postLink: string): StatusKind {
  const text = status.trim().toLowerCase();
  if (!text || text === "pending") return "pending";
  if (text === "claimed") return "claimed";
  // Verification results written by the people who check posts. Anchored at the start so an automation error such as
  // "Failed: Failed to update proxy" is never mistaken for a proxy-issue check result.
  if (/^alive\b/.test(text)) return validPostUrl(postLink) ? "alive" : postLink.trim() ? "posted_bad_link" : "posted_no_link";
  if (/^(post\s+)?(delete[d]?|removed)\b/.test(text)) return "deleted";
  if (/^proxy\b/.test(text)) return "proxy_issue";
  if (text.startsWith("posted")) {
    if (validPostUrl(postLink)) return "posted";
    return postLink.trim() ? "posted_bad_link" : "posted_no_link";
  }
  if (text.startsWith("failed (stopped)")) return "stopped";
  if (text.startsWith("failed (timeout/retryable)")) return "failed_retryable";
  if (text.startsWith("failed")) return "failed";
  return "other";
}

export type ExistingPublication = { id: string; visibility: Visibility };
export type SyncItem = { rowNumber: number; profileName: string; url: string | null; kind: StatusKind; status: string };
// One entry per profile among the posts about to be imported. knownCustomerIds comes from posts the dashboard already
// holds for that exact profile name: none = a new profile, one = a clear match, several = ambiguous.
export type ProfileGroup = { profile: string; posts: number; knownCustomerIds: string[] };
export type SyncView = {
  total: number;
  counts: Record<StatusKind, number>;
  attention: SyncItem[];
  attentionTotal: number;
  importable: ImportedRow[];
  importableTotal: number;
  profiles: ProfileGroup[];
  inDashboard: number;
  crossCheck: Partial<Record<Visibility, number>>;
  duplicateLinks: number;
};

export const MAX_IMPORT = 300;
export const MAX_ATTENTION = 100;

const emptyCounts = (): Record<StatusKind, number> => ({ pending: 0, claimed: 0, posted: 0, alive: 0, deleted: 0, proxy_issue: 0, posted_no_link: 0, posted_bad_link: 0, failed: 0, failed_retryable: 0, stopped: 0, other: 0 });
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

function toImportedRow(row: SheetRow, url: string): ImportedRow {
  const title = clean(row.title);
  return {
    title: (title.length >= 3 ? title : `Untitled post (sheet row ${row.rowNumber})`).slice(0, 200),
    url,
    account_label: clean(row.profileName).slice(0, 120) || "Unknown account",
    published_at: null,
  };
}

// Only rows reported as posted with a usable link become import candidates, and the
// sheet's publication date is unknown, so published_at is never invented.
export function buildSyncView(rows: SheetRow[], existing: Map<string, ExistingPublication>, profileCustomers: Map<string, Set<string>> = new Map()): SyncView {
  const counts = emptyCounts();
  const attention: SyncItem[] = [];
  const importable: ImportedRow[] = [];
  const crossCheck: Partial<Record<Visibility, number>> = {};
  const seen = new Set<string>();
  let importableTotal = 0, inDashboard = 0, duplicateLinks = 0, attentionTotal = 0;

  for (const row of rows) {
    const kind = classifyStatus(row.status, row.postLink);
    counts[kind]++;
    const url = validPostUrl(row.postLink);
    if ((kind === "posted" || kind === "alive") && url) {
      if (seen.has(url)) { duplicateLinks++; continue; }
      seen.add(url);
      const known = existing.get(url);
      if (known) {
        inDashboard++;
        crossCheck[known.visibility] = (crossCheck[known.visibility] ?? 0) + 1;
      } else {
        importableTotal++;
        if (importable.length < MAX_IMPORT) importable.push(toImportedRow(row, url));
      }
    } else if (kind !== "pending") {
      attentionTotal++;
      if (attention.length < MAX_ATTENTION) attention.push({ rowNumber: row.rowNumber, profileName: clean(row.profileName), url, kind, status: clean(row.status).slice(0, 160) });
    }
  }
  const posts = new Map<string, number>();
  for (const item of importable) posts.set(item.account_label, (posts.get(item.account_label) ?? 0) + 1);
  const profiles: ProfileGroup[] = [...posts]
    .map(([profile, count]) => ({ profile, posts: count, knownCustomerIds: [...(profileCustomers.get(profile) ?? [])] }))
    .sort((a, b) => b.posts - a.posts || a.profile.localeCompare(b.profile));
  return { total: rows.length, counts, attention, attentionTotal, importable, importableTotal, profiles, inDashboard, crossCheck, duplicateLinks };
}

// The endpoint must be an Apps Script web app over HTTPS: the server will POST a secret to it.
export function parseSyncEndpoint(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "script.google.com" || url.username || url.password || url.port) return null;
    if (!/^\/(a\/macros\/[A-Za-z0-9.-]+\/|macros\/)s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url;
  } catch { return null; }
}
