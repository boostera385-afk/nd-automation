import type { Comment, Publication } from "./types";
import { DAY_MS } from "./daily-board";

export type InboxBinding = { account_label: string; profile_id: string };

export type InboxPost = { post: Publication; comments: Comment[] };

export type InboxProfile = {
  profile: string;
  /** Incogniton profile to open, when this account is bound to one. */
  profileId: string | null;
  profileName: string | null;
  posts: InboxPost[];
  commentCount: number;
  lastCommentAt: string;
};

export type QuietProfile = { profile: string; posts: number };

export type CommentInbox = {
  /** Open these profiles: each has at least one post with a comment from someone else. */
  open: InboxProfile[];
  /** Checked posts in the window, no new comments. Safe to skip. */
  quiet: QuietProfile[];
  /** Posts in the window that no check has read yet. Absence of comments is unknown. */
  unchecked: Publication[];
};

const time = (value: string | null | undefined) => {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which profiles need opening today. A post counts when it was published in the
 * window or received a comment in it, so a reply owed on an older post is not
 * lost. A comment written by the posting account itself is our own reply and
 * does not count. A post no check has read is listed separately: "no comments"
 * is never assumed for something nobody looked at.
 */
export function buildCommentInbox(input: {
  publications: Publication[];
  comments: Comment[];
  bindings?: InboxBinding[];
  profileNames?: Map<string, string>;
  now: number;
  windowMs?: number;
}): CommentInbox {
  const cutoff = input.now - (input.windowMs ?? DAY_MS);
  const boundProfile = new Map((input.bindings ?? []).map((binding) => [binding.account_label, binding.profile_id]));
  const postById = new Map(input.publications.map((post) => [post.id, post]));

  const fresh = new Map<string, Comment[]>();
  for (const comment of input.comments) {
    const post = postById.get(comment.publication_id);
    const seen = time(comment.first_observed_at);
    if (!post || seen === null || seen < cutoff) continue;
    if (sameName(comment.author_label, post.account_label)) continue;
    fresh.set(post.id, [...(fresh.get(post.id) ?? []), comment]);
  }

  const open = new Map<string, InboxProfile>();
  const quiet = new Map<string, QuietProfile>();
  const unchecked: Publication[] = [];
  for (const post of input.publications) {
    const comments = fresh.get(post.id);
    const posted = time(post.published_at ?? post.created_at);
    if (!comments && (posted === null || posted < cutoff)) continue;
    const profile = post.account_label || "Unnamed profile";
    if (comments) {
      const profileId = boundProfile.get(post.account_label) ?? null;
      const entry = open.get(profile) ?? { profile, profileId, profileName: profileId ? input.profileNames?.get(profileId) ?? null : null, posts: [], commentCount: 0, lastCommentAt: "" };
      const sorted = [...comments].sort((a, b) => (time(b.first_observed_at) ?? 0) - (time(a.first_observed_at) ?? 0));
      entry.posts.push({ post, comments: sorted });
      entry.commentCount += sorted.length;
      if (sorted[0].first_observed_at > entry.lastCommentAt) entry.lastCommentAt = sorted[0].first_observed_at;
      open.set(profile, entry);
    } else if (!post.last_checked_at && !post.last_observed_at) {
      unchecked.push(post);
    } else {
      const entry = quiet.get(profile) ?? { profile, posts: 0 };
      entry.posts += 1;
      quiet.set(profile, entry);
    }
  }

  for (const entry of open.values()) {
    entry.posts.sort((a, b) => (b.comments[0].first_observed_at).localeCompare(a.comments[0].first_observed_at));
  }
  return {
    open: [...open.values()].sort((a, b) => b.commentCount - a.commentCount || b.lastCommentAt.localeCompare(a.lastCommentAt)),
    // A profile with something to open is never also reported as quiet.
    quiet: [...quiet.values()].filter((entry) => !open.has(entry.profile)).sort((a, b) => a.profile.localeCompare(b.profile)),
    unchecked,
  };
}
