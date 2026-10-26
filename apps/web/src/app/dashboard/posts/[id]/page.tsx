import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getPublication, requireWorkspace } from "@/lib/data";
import { uuid } from "@/lib/validation";
import { formatTime } from "@/lib/time";
import { getChecksForPost } from "@/lib/checks-data";
import { ObservationForm, CommentForm, SingleCheckForm } from "@/components/reporting-forms";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { organization, isStaff } = await requireWorkspace();
  const record = await getPublication(id);
  if (!record) notFound();
  const { publication: post, observations, comments } = record;
  const checks = await getChecksForPost(id);
  return <><PageHeader title={post.title} description={`${post.account_label} · Published: ${formatTime(post.published_at, organization.time_zone)}`} actions={<a className="button secondary" href={post.url} target="_blank" rel="noopener noreferrer">Open exact post <ExternalLink size={15} /></a>} /><div className="notice subtle"><Badge status={post.visibility} /><p>Last manual review: {formatTime(post.last_observed_at, organization.time_zone)}. Access can change after an observation. A failed login is not evidence of removal.</p></div><div className="two-column wide-left"><div className="stack">{checks.length > 0 && <Panel title="Check results" hint="Newest first"><ul className="result-feed">{checks.map((check) => <li key={check.id} className={`tone-${check.tone}`}><span className="result-dot" aria-hidden /><div><strong>{check.message}</strong>{check.notes && <p className="muted">{check.notes}</p>}</div><time dateTime={check.checked_at}>{formatTime(check.checked_at, organization.time_zone)}</time></li>)}</ul></Panel>}<Panel title="Observation history" hint="Latest 100 observations">{observations.length ? <ol className="timeline">{observations.map((item) => <li key={item.id}><div><Badge status={item.visibility} /><time>{formatTime(item.observed_at, organization.time_zone)}</time></div><p>{item.notes || "No additional viewing-context notes."}</p><small>Manual review · Comments: {item.comments_total ?? "unknown"} · Collection {item.comments_complete ? "reported complete" : "partial / not established"}</small></li>)}</ol> : <EmptyState title="Not reviewed yet">An imported or recorded URL does not establish visibility. Save a manual observation after reviewing the exact post.</EmptyState>}</Panel><Panel title="Recorded comments" hint="Latest 200 recorded comments">{comments.length ? <div className="comment-list">{comments.map((comment) => <article key={comment.id}><strong>{comment.author_label}</strong><p>{comment.body}</p><small>First observed {formatTime(comment.first_observed_at, organization.time_zone)}{!comment.platform_created_at && " · Platform creation time unknown"}</small></article>)}</div> : <EmptyState title="No comments recorded">This means no comment records are stored—not that the post has zero comments.</EmptyState>}</Panel></div>{isStaff && <div className="stack"><Panel title="Record a check"><SingleCheckForm publicationId={id} /></Panel><Panel title="Record detailed observation"><ObservationForm publicationId={id} /></Panel><Panel title="Record a comment"><CommentForm publicationId={id} /></Panel></div>}</div></>;
}
