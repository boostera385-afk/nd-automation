import { describe, expect, it } from "vitest";
import { buildCommentInbox } from "@/lib/comment-inbox";
import type { Comment, Publication } from "@/lib/types";

const now = Date.parse("2026-10-31T15:00:00.000Z");
const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();
const post = (id: string, account: string, overrides: Partial<Publication> = {}): Publication => ({
  id, organization_id: "o", customer_id: "c1", title: `Post ${id}`, url: `https://nextdoor.com/p/${id}`,
  account_label: account, published_at: at(2), source: "sheet_import", created_at: at(3),
  visibility: "live", last_observed_at: at(1), comments_total: null, recorded_session_id: null, last_checked_at: at(1), ...overrides,
});
const comment = (id: string, publication: string, hoursAgo: number, author = "Neighbor"): Comment => ({
  id, publication_id: publication, body: `comment ${id}`, author_label: author,
  platform_created_at: null, first_observed_at: at(hoursAgo), source_comment_id: null,
});

describe("comment inbox", () => {
  it("lists only profiles with comments to open, with their Incogniton profile", () => {
    const inbox = buildCommentInbox({
      publications: [post("p1", "Alice"), post("p2", "Alice"), post("p3", "Bob")],
      comments: [comment("m1", "p1", 1), comment("m2", "p1", 3)],
      bindings: [{ account_label: "Alice", profile_id: "uuid-a" }],
      profileNames: new Map([["uuid-a", "ND 014"]]),
      now,
    });
    expect(inbox.open).toHaveLength(1);
    expect(inbox.open[0]).toMatchObject({ profile: "Alice", profileId: "uuid-a", profileName: "ND 014", commentCount: 2 });
    expect(inbox.open[0].posts.map((entry) => entry.post.id)).toEqual(["p1"]);
    expect(inbox.open[0].posts[0].comments.map((entry) => entry.id)).toEqual(["m1", "m2"]);
    expect(inbox.quiet).toEqual([{ profile: "Bob", posts: 1 }]);
  });

  it("ignores the posting account's own replies", () => {
    const inbox = buildCommentInbox({ publications: [post("p1", "Alice")], comments: [comment("m1", "p1", 1, " alice ")], now });
    expect(inbox.open).toHaveLength(0);
    expect(inbox.quiet).toEqual([{ profile: "Alice", posts: 1 }]);
  });

  it("keeps a fresh comment on an older post and drops stale ones", () => {
    const inbox = buildCommentInbox({
      publications: [post("old", "Alice", { published_at: at(72) }), post("older", "Bob", { published_at: at(96) })],
      comments: [comment("m1", "old", 2), comment("m2", "older", 30)],
      now,
    });
    expect(inbox.open.map((entry) => entry.profile)).toEqual(["Alice"]);
    expect(inbox.quiet).toEqual([]);
  });

  it("never reports an unread post as quiet", () => {
    const inbox = buildCommentInbox({ publications: [post("p1", "Alice", { last_checked_at: null, last_observed_at: null })], comments: [], now });
    expect(inbox.quiet).toEqual([]);
    expect(inbox.unchecked.map((entry) => entry.id)).toEqual(["p1"]);
  });

  it("sorts the busiest profile first and does not repeat it as quiet", () => {
    const inbox = buildCommentInbox({
      publications: [post("p1", "Alice"), post("p2", "Bob"), post("p3", "Bob")],
      comments: [comment("m1", "p1", 1), comment("m2", "p2", 1), comment("m3", "p2", 2)],
      now,
    });
    expect(inbox.open.map((entry) => entry.profile)).toEqual(["Bob", "Alice"]);
    expect(inbox.quiet).toEqual([]);
  });
});
