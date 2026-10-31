import type { Comment, Customer, Publication } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type ProfileDay = {
  profile: string;
  customer: string;
  posts24h: number;
  comments24h: number;
  postsLoaded: number;
  commentsLoaded: number;
  lastObservedAt: string | null;
  lastPostAt: string | null;
};

/**
 * Counts only. Nothing here opens a thread, and a missing count stays missing:
 * `comments_total` is the platform's own number when a check read it, never a
 * guess from the rows we happen to have stored.
 */
export function profileDayBoard(input: {
  publications: Publication[];
  comments: Comment[];
  customers: Customer[];
  now: number;
  windowMs?: number;
}): ProfileDay[] {
  const windowMs = input.windowMs ?? DAY_MS;
  const cutoff = input.now - windowMs;
  const customerName = new Map(input.customers.map((customer) => [customer.id, customer.name]));
  const byProfile = new Map<string, ProfileDay>();

  const row = (profile: string, customer: string) => {
    const key = profile;
    const found = byProfile.get(key);
    if (found) return found;
    const created: ProfileDay = {
      profile, customer, posts24h: 0, comments24h: 0, postsLoaded: 0, commentsLoaded: 0,
      lastObservedAt: null, lastPostAt: null,
    };
    byProfile.set(key, created);
    return created;
  };

  const profileOf = new Map<string, string>();
  for (const publication of input.publications) {
    const profile = publication.account_label || "Unnamed profile";
    profileOf.set(publication.id, profile);
    const entry = row(profile, customerName.get(publication.customer_id) ?? "Unassigned customer");
    entry.postsLoaded += 1;
    const posted = Date.parse(publication.published_at ?? publication.created_at);
    if (Number.isFinite(posted)) {
      if (posted >= cutoff) entry.posts24h += 1;
      if (!entry.lastPostAt || posted > Date.parse(entry.lastPostAt)) entry.lastPostAt = new Date(posted).toISOString();
    }
  }

  for (const comment of input.comments) {
    const profile = profileOf.get(comment.publication_id);
    if (!profile) continue;
    const entry = row(profile, "Assigned customer");
    entry.commentsLoaded += 1;
    const observed = Date.parse(comment.first_observed_at);
    if (!Number.isFinite(observed)) continue;
    if (observed >= cutoff) entry.comments24h += 1;
    if (!entry.lastObservedAt || observed > Date.parse(entry.lastObservedAt)) entry.lastObservedAt = new Date(observed).toISOString();
  }

  return [...byProfile.values()].sort((a, b) => b.comments24h - a.comments24h || b.posts24h - a.posts24h || a.profile.localeCompare(b.profile));
}

/** "Oct 30, 8:24 AM → Oct 31, 8:24 AM PDT" for the rolling window. */
export function windowLabel(now: number, zone: string, windowMs = DAY_MS): string {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `${formatter.format(new Date(now - windowMs))} → ${formatter.format(new Date(now))}`;
}

/** Short line for a profile row: counts only, never a thread body. */
export function profileCountLine(entry: ProfileDay): string {
  return `${entry.posts24h} post(s) · ${entry.comments24h} comment(s) in the last 24 hours`;
}
