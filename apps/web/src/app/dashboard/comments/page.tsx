import Link from "next/link";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { formatTime } from "@/lib/time";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function Comments() {
  const { organization } = await requireWorkspace();
  const { comments, publications, truncated } = await getDashboardData();
  const grouped = Map.groupBy(comments, (comment) => comment.publication_id);
  return <><PageHeader title="Comments by exact post" description="Manually recorded observations. First-observed time is not assumed to be the comment’s platform creation time." />{truncated && <p className="notice">Loaded comment/post limits reached. This view is partial.</p>}{grouped.size ? <div className="stack">{[...grouped].map(([id, records]) => <Panel key={id} title={publications.find((post) => post.id === id)?.title || "Authorized publication"} hint={`${records.length} stored comments`}><Link className="text-link" href={`/dashboard/posts/${id}`}>View post & observation history</Link><div className="comment-list">{records.map((comment) => <article key={comment.id}><strong>{comment.author_label}</strong><p>{comment.body}</p><small>First observed {formatTime(comment.first_observed_at, organization.time_zone)} · {comment.platform_created_at ? `Created ${formatTime(comment.platform_created_at, organization.time_zone)}` : "Creation time unknown"}</small></article>)}</div></Panel>)}</div> : <Panel title="Recorded comments"><EmptyState title="No comment records yet">Open a post detail page to record an authorized comment. No comment collection or automatic replies are running.</EmptyState></Panel>}</>;
}
