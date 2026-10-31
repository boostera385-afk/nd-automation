import { describe, expect, it } from "vitest";
import { DAY_MS, profileCountLine, profileDayBoard, windowLabel } from "@/lib/daily-board";
import type { Comment, Customer, Publication } from "@/lib/types";

const now = Date.parse("2026-10-31T15:00:00.000Z");
const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();
const customer = (id: string, name: string): Customer => ({ id, organization_id: "o", name, time_zone: "America/Los_Angeles", service: null, created_at: at(500) });
const post = (id: string, account: string, overrides: Partial<Publication> = {}): Publication => ({
  id, organization_id: "o", customer_id: "c1", title: `Post ${id}`, url: `https://nextdoor.com/p/${id}`,
  account_label: account, published_at: at(2), source: "sheet_import", created_at: at(3),
  visibility: "live", last_observed_at: at(1), comments_total: null, recorded_session_id: null, ...overrides,
});
const comment = (id: string, publication: string, hoursAgo: number): Comment => ({
  id, publication_id: publication, body: "body", author_label: "Someone",
  platform_created_at: null, first_observed_at: at(hoursAgo), source_comment_id: null,
});

const board = (publications: Publication[], comments: Comment[]) => profileDayBoard({ publications, comments, customers: [customer("c1", "ND Test")], now });

describe("profile day board", () => {
  it("groups posts and comments by profile with customer names", () => {
    const rows = board([post("p1", "Profile A"), post("p2", "Profile A"), post("p3", "Profile B")], [comment("m1", "p1", 1)]);
    expect(rows.map((row) => row.profile).sort()).toEqual(["Profile A", "Profile B"]);
    const a = rows.find((row) => row.profile === "Profile A")!;
    expect(a.customer).toBe("ND Test");
    expect(a.posts24h).toBe(2);
    expect(a.postsLoaded).toBe(2);
    expect(a.comments24h).toBe(1);
  });

  it("excludes posts and comments outside the rolling window", () => {
    const rows = board([post("p1", "A", { published_at: at(30) }), post("p2", "A")], [comment("m1", "p1", 30), comment("m2", "p2", 1)]);
    expect(rows[0].posts24h).toBe(1);
    expect(rows[0].comments24h).toBe(1);
    expect(rows[0].postsLoaded).toBe(2);
  });

  it("falls back to the record time when the platform date is unknown", () => {
    const rows = board([post("p1", "A", { published_at: null, created_at: at(5) })], []);
    expect(rows[0].posts24h).toBe(1);
  });

  it("never counts a comment for a post it has not loaded", () => {
    const rows = board([post("p1", "A")], [comment("m1", "missing", 1)]);
    expect(rows[0].comments24h).toBe(0);
  });

  it("tracks the most recent post and comment times it actually saw", () => {
    const rows = board([post("p1", "A", { published_at: at(6) }), post("p2", "A", { published_at: at(2) })], [comment("m1", "p1", 4), comment("m2", "p2", 1)]);
    expect(rows[0].lastPostAt).toBe(at(2));
    expect(rows[0].lastObservedAt).toBe(at(1));
  });

  it("sorts profiles with the most comments first", () => {
    const rows = board([post("p1", "Quiet"), post("p2", "Busy")], [comment("m1", "p2", 1), comment("m2", "p2", 2)]);
    expect(rows.map((row) => row.profile)).toEqual(["Busy", "Quiet"]);
  });

  it("includes the exact window boundary and nothing one millisecond older", () => {
    const edge = board([post("p1", "A", { published_at: new Date(now - DAY_MS).toISOString() })], []);
    expect(edge[0].posts24h).toBe(1);
    const older = board([post("p1", "A", { published_at: new Date(now - DAY_MS - 1).toISOString() })], []);
    expect(older[0].posts24h).toBe(0);
  });

  it("returns an empty board instead of inventing profiles", () => {
    expect(board([], [])).toEqual([]);
  });
});

describe("labels", () => {
  it("describes the rolling window with an explicit zone", () => {
    const label = windowLabel(now, "America/Los_Angeles");
    expect(label).toContain("→");
    expect(label).toContain("PDT");
  });

  it("states counts only, never a thread body", () => {
    const rows = board([post("p1", "A")], [comment("m1", "p1", 1)]);
    expect(profileCountLine(rows[0])).toBe("1 post(s) · 1 comment(s) in the last 24 hours");
  });
});
