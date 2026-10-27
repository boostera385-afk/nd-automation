import { describe, expect, it } from "vitest";
import { isMissingSchemaError } from "@/lib/checks";
import { formatAgo, newlyArrived, notificationHref, strongestTone, unreadCount } from "@/lib/notifications";

describe("notification helpers", () => {
  it("plays one sound for the most important tone", () => {
    expect(strongestTone([])).toBe("positive");
    expect(strongestTone([{ tone: "positive" }, { tone: "attention" }])).toBe("attention");
    expect(strongestTone([{ tone: "attention" }, { tone: "negative" }, { tone: "positive" }])).toBe("negative");
  });

  it("counts only notifications newer than the last time they were seen", () => {
    const items = [{ created_at: "2026-10-27T10:00:00.000Z" }, { created_at: "2026-10-27T09:00:00.000Z" }];
    expect(unreadCount(items, Date.parse("2026-10-27T09:30:00.000Z"))).toBe(1);
    expect(unreadCount(items, Date.parse("2026-10-27T11:00:00.000Z"))).toBe(0);
    expect(unreadCount(items, null)).toBe(0);
  });

  it("describes elapsed time in plain words", () => {
    const now = Date.parse("2026-10-27T12:00:00.000Z");
    expect(formatAgo("2026-10-27T11:59:40.000Z", now)).toBe("Just now");
    expect(formatAgo("2026-10-27T11:30:00.000Z", now)).toBe("30 min ago");
    expect(formatAgo("2026-10-27T09:00:00.000Z", now)).toBe("3 h ago");
    expect(formatAgo("2026-10-25T12:00:00.000Z", now)).toBe("2 d ago");
    expect(formatAgo("2026-10-27T12:05:00.000Z", now)).toBe("Just now");
  });

  it("links a single-post result to the post and a batch to the checks page", () => {
    expect(notificationHref({ publication_id: "abc", kind: "check_result" })).toBe("/dashboard/posts/abc");
    expect(notificationHref({ publication_id: null, kind: "check_batch" })).toBe("/dashboard/checks");
    expect(notificationHref({ publication_id: null, kind: "publish_result" })).toBe("/dashboard/publishing");
  });

  it("stays silent the first time a device sees existing notifications, then announces only new ones", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(newlyArrived(items, null)).toEqual({ fresh: ["a", "b"], announce: false });
    expect(newlyArrived(items, new Set(["a", "b"]))).toEqual({ fresh: [], announce: false });
    expect(newlyArrived([{ id: "c" }, ...items], new Set(["a", "b"]))).toEqual({ fresh: ["c"], announce: true });
  });
});

describe("isMissingSchemaError", () => {
  it("recognises an unapplied migration so the dashboard can degrade gracefully", () => {
    expect(isMissingSchemaError({ code: "42P01" })).toBe(true);
    expect(isMissingSchemaError({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isMissingSchemaError({ code: "PGRST202" })).toBe(true);
    expect(isMissingSchemaError({ message: "relation \"x\" does not exist" })).toBe(true);
  });
  it("does not hide genuine failures", () => {
    expect(isMissingSchemaError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingSchemaError({ code: "XX000", message: "internal error" })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
  });
});
