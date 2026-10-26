import type { Comment, Publication } from "./types";
import { isInDay, isStale } from "./time";

export function reportSnapshot(publications: Publication[], comments: Comment[], day: string, zone: string, now = new Date()) {
  const cohort = publications.filter((post) => isInDay(post.published_at, day, zone));
  return {
    day, zone, generatedAt: now.toISOString(), cohort,
    lastObservedLive: cohort.filter((post) => post.visibility === "live").length,
    notReviewed: cohort.filter((post) => !post.last_observed_at).length,
    stale: cohort.filter((post) => post.last_observed_at && isStale(post.last_observed_at, now)).length,
    commentsCreated: comments.filter((comment) => isInDay(comment.platform_created_at, day, zone)).length,
    commentsFirstObserved: comments.filter((comment) => isInDay(comment.first_observed_at, day, zone)).length,
    unknownDates: publications.filter((post) => !post.published_at).length,
  };
}
