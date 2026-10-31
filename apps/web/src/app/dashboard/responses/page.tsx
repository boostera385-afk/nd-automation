import Link from "next/link";
import { requireWorkspace, getDashboardData } from "@/lib/data";
import { profileDayBoard, windowLabel, DAY_MS } from "@/lib/daily-board";
import { PageHeader, Panel } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { formatTime } from "@/lib/time";
import { buildCommentInbox } from "@/lib/comment-inbox";
import { getOperationsData } from "@/lib/operations-data";

export default async function Responses({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db, organization } = await requireWorkspace(true);
  const params = await searchParams;
  const profile = typeof params.profile === "string" ? params.profile : null;
  const [data, operations, inventory] = await Promise.all([
    getDashboardData(),
    getOperationsData(),
    db.from("reporting_profile_inventory").select("profile_id,name").eq("organization_id", organization.id).limit(1000),
  ]);
  const now = new Date().getTime();
  const board = profileDayBoard({ publications: data.publications, comments: data.comments, customers: data.customers, now });
  const shown = profile ? board.filter((row) => row.profile === profile) : board;
  const cutoff = now - DAY_MS;
  const posts = data.publications
    .filter((post) => !profile || post.account_label === profile)
    .filter((post) => Date.parse(post.published_at ?? post.created_at) >= cutoff)
    .sort((a, b) => Date.parse(b.published_at ?? b.created_at) - Date.parse(a.published_at ?? a.created_at));
  const commentCount = new Map<string, number>();
  for (const comment of data.comments) {
    if (Date.parse(comment.first_observed_at) < cutoff) continue;
    commentCount.set(comment.publication_id, (commentCount.get(comment.publication_id) ?? 0) + 1);
  }
  const inbox = buildCommentInbox({
    publications: profile ? data.publications.filter((post) => post.account_label === profile) : data.publications,
    comments: data.comments,
    bindings: operations.bindings,
    profileNames: new Map((inventory.data ?? []).map((row) => [row.profile_id as string, row.name as string])),
    now,
  });
  return <>
    <PageHeader eyebrow="RESPONSES" title={profile ? `Responses · ${profile}` : "Responses"} description={`Posts and saved comment counts from the last 24 hours. Counts describe what was observed, not a live guarantee. ${windowLabel(now, organization.time_zone)}`} actions={<LiveRefresh />} />
    <Panel title={inbox.open.length ? `Open these ${inbox.open.length} profile(s)` : "Nothing to open"} hint="Comments from others in the last 24 hours">
      {inbox.open.length === 0 ? <p>No saved comment from anyone else in the last 24 hours. {inbox.quiet.length} profile(s) were checked and are quiet.</p> : <div className="stack">{inbox.open.map((entry) => <article key={entry.profile} className="notice subtle">
        <p><strong>{entry.profile}</strong> · {entry.commentCount} comment(s) on {entry.posts.length} post(s) · Incogniton: {entry.profileName ?? "not bound"}{entry.profileId && <> <code>{entry.profileId}</code></>}</p>
        {entry.posts.map(({ post, comments }) => <div key={post.id}><p><a className="text-link" href={post.url} target="_blank" rel="noreferrer">{post.title.slice(0, 90)}{post.title.length > 90 ? "…" : ""}</a> · {comments.length} new · <Link className="text-link" href={`/dashboard/posts/${post.id}`}>History</Link></p>
          {comments.slice(0, 3).map((comment) => <p key={comment.id} className="small"><strong>{comment.author_label}:</strong> {comment.body.slice(0, 200)}{comment.body.length > 200 ? "…" : ""} <span className="muted">({formatTime(comment.first_observed_at, organization.time_zone)})</span></p>)}
          {comments.length > 3 && <p className="small muted">+{comments.length - 3} more in History</p>}</div>)}
      </article>)}</div>}
      {inbox.quiet.length > 0 && <details><summary>{inbox.quiet.length} quiet profile(s) — skip</summary><p className="small">{inbox.quiet.map((entry) => `${entry.profile} (${entry.posts})`).join(", ")}</p></details>}
      {inbox.unchecked.length > 0 && <p className="notice">{inbox.unchecked.length} post(s) from the last 24 hours have never been checked, so their comments are unknown. Run a check batch, or open them by hand: {[...new Set(inbox.unchecked.map((post) => post.account_label))].join(", ")}.</p>}
    </Panel>
    <Panel title="Profiles in this window" hint="Counts only">
      {profile && <p className="small"><Link href="/dashboard/responses">Show every profile →</Link></p>}
      {shown.length === 0 ? <p>No saved post or comment falls inside this window yet. Run a check batch to collect one.</p> : <div className="table-wrap"><table><thead><tr><th>Profile</th><th>Customer</th><th>Posts</th><th>Comments</th><th>Last comment seen</th><th></th></tr></thead><tbody>{shown.map((row) => <tr key={row.profile}><td>{row.profile}</td><td>{row.customer}</td><td>{row.posts24h}</td><td>{row.comments24h}</td><td>{row.lastObservedAt ? formatTime(row.lastObservedAt, organization.time_zone) : "Not observed"}</td><td><Link className="text-link" href={`/dashboard/responses?profile=${encodeURIComponent(row.profile)}`}>{profile === row.profile ? "Showing" : "Open"}</Link></td></tr>)}</tbody></table></div>}
    </Panel>
    <Panel title="Posts from the last 24 hours" hint={profile ? profile : "All loaded profiles"}>
      {posts.length === 0 ? <p>No tracked post was recorded inside this window. A missing row means nothing was saved, not that nothing was posted on Nextdoor.</p> : <div className="table-wrap"><table><thead><tr><th>Post</th><th>Profile</th><th>Comments saved</th><th>Published</th><th></th></tr></thead><tbody>{posts.slice(0, 100).map((post) => <tr key={post.id}><td>{post.title.slice(0, 90)}{post.title.length > 90 ? "…" : ""}</td><td>{post.account_label}</td><td>{commentCount.get(post.id) ?? 0}</td><td>{post.published_at ? formatTime(post.published_at, organization.time_zone) : "Unknown date"}</td><td><Link className="text-link" href={`/dashboard/posts/${post.id}`}>Open thread</Link></td></tr>)}</tbody></table></div>}
      {posts.length > 100 && <p className="notice">Showing the 100 most recent posts in this window.</p>}
    </Panel>
    <Panel title="Replying" hint="Not enabled in the dashboard yet">
      <p>Sending a reply needs a worker job type that does not exist, and the pilot Nextdoor account is still suspended. Opening a thread here is read-only: it shows the comments already saved. Reply on Nextdoor for now; a dashboard reply flow will get its own approval and live test before any send button appears.</p>
    </Panel>
  </>;
}
