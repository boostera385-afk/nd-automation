import type { NotificationItem } from "./types";

type Tone = NotificationItem["tone"];
const rank: Record<Tone, number> = { negative: 2, attention: 1, positive: 0 };

// When several results arrive together, one sound is played for the most important tone.
export function strongestTone(items: Pick<NotificationItem, "tone">[]): Tone {
  return items.reduce<Tone>((best, item) => (rank[item.tone] > rank[best] ? item.tone : best), "positive");
}

export function unreadCount(items: Pick<NotificationItem, "created_at">[], lastSeenMs: number | null): number {
  if (lastSeenMs === null) return 0;
  return items.filter((item) => Date.parse(item.created_at) > lastSeenMs).length;
}

export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "Just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

// Where a notification should take the reader.
export function notificationHref(item: Pick<NotificationItem, "publication_id" | "kind">): string {
  return item.publication_id ? `/dashboard/posts/${item.publication_id}` : "/dashboard/checks";
}

// First run on a device records what already exists without announcing it; afterwards only unseen ids are announced.
export function newlyArrived(items: Pick<NotificationItem, "id">[], handled: Set<string> | null): { fresh: string[]; announce: boolean } {
  if (handled === null) return { fresh: items.map((item) => item.id), announce: false };
  const fresh = items.filter((item) => !handled.has(item.id)).map((item) => item.id);
  return { fresh, announce: fresh.length > 0 };
}
