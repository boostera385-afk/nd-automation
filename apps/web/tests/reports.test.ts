import { expect, it } from "vitest";
import { reportSnapshot } from "@/lib/reports";
import type { Comment, Publication } from "@/lib/types";

it("separates publication cohort from comment creation and first observation", () => {
  const posts = [
    { id: "current", published_at: "2026-10-25T17:00:00Z", visibility: "live", last_observed_at: "2026-10-26T17:00:00Z" },
    { id: "older", published_at: "2026-10-20T17:00:00Z", visibility: "not_checked", last_observed_at: null },
    { id: "unknown", published_at: null, visibility: "not_checked", last_observed_at: null },
  ] as Publication[];
  const comments = [
    { publication_id: "older", platform_created_at: "2026-10-25T18:00:00Z", first_observed_at: "2026-10-26T18:00:00Z" },
    { publication_id: "current", platform_created_at: null, first_observed_at: "2026-10-25T18:00:00Z" },
  ] as Comment[];
  const result = reportSnapshot(posts, comments, "2026-10-25", "America/Los_Angeles", new Date("2026-10-26T18:00:00Z"));
  expect(result.cohort.map((post) => post.id)).toEqual(["current"]);
  expect(result.commentsCreated).toBe(1);
  expect(result.commentsFirstObserved).toBe(1);
  expect(result.unknownDates).toBe(1);
});
