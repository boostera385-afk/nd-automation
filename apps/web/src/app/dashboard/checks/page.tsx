import Link from "next/link";
import { CircleCheck, CircleX, ClipboardList, TriangleAlert } from "lucide-react";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { getRecentChecks } from "@/lib/checks-data";
import { needsCheck, outcomeInfo } from "@/lib/checks";
import { formatTime, isStale } from "@/lib/time";
import { CheckQueue, type QueueRow } from "@/components/check-queue";
import { EmptyState, PageHeader, Panel, StatCard } from "@/components/ui";

export default async function Checks() {
  const { organization, isStaff } = await requireWorkspace();
  const { publications, customers, truncated } = await getDashboardData();
  const { available, checks } = await getRecentChecks();
  const zone = organization.time_zone;
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  const titles = new Map(publications.map((post) => [post.id, post.title]));

  const reasonFor = (post: (typeof publications)[number]) => {
    const info = outcomeInfo(post.last_check_outcome);
    if (info?.tone === "attention") return `Last attempt could not finish: ${info.label}`;
    if (post.visibility === "not_checked") return "Never checked";
    return "Last result is over 24 hours old";
  };
  const queue = publications.filter((post) => needsCheck(post, isStale(post.last_observed_at)));
  const rows: QueueRow[] = queue.map((post) => ({
    id: post.id, title: post.title, customer: customerNames.get(post.customer_id) || "Assigned customer", account: post.account_label,
    visibility: post.visibility, outcome: post.last_check_outcome ?? null, lastChecked: post.last_checked_at ? formatTime(post.last_checked_at, zone) : "Never", reason: reasonFor(post),
  }));
  const last = (tone: "positive" | "negative" | "attention") => publications.filter((post) => outcomeInfo(post.last_check_outcome)?.tone === tone).length;

  return <>
    <PageHeader title="Post checks" description="Open each post, then record what you found. Proxy, login and network problems are saved as “could not check”, never as a removal." actions={isStaff && <Link className="button secondary" href="/dashboard/sheet-sync">Sheet sync</Link>} />
    {!available && <div className="notice"><strong>One-time database update needed</strong><p>{isStaff ? "Post checks and notifications need the latest database migration (202610270001). Ask your administrator to apply it; nothing else changes until then." : "This feature is being set up. Please check back soon."}</p></div>}
    {truncated && <p className="notice">Loaded-data limit reached. These lists are partial; full pagination is a later milestone.</p>}
    <div className="stats-grid">
      <StatCard label="Need a check" value={queue.length} hint="Never checked, over 24 hours old, or last attempt failed" icon={ClipboardList} />
      <StatCard label="Alive at last check" value={last("positive")} hint="Positive results" icon={CircleCheck} />
      <StatCard label="Removed or not accessible" value={last("negative")} hint="Negative results" icon={CircleX} />
      <StatCard label="Could not check" value={last("attention")} hint="Proxy, login, verification, network or profile" icon={TriangleAlert} />
    </div>
    <Panel title={`Needs a check · ${queue.length}`} hint="Select posts, then record the result">
      {queue.length === 0 ? <EmptyState title="Everything is up to date">No post needs a check right now. New imports and stale results will appear here.</EmptyState>
        : isStaff ? <CheckQueue rows={rows} /> : <p className="muted">Your team records post checks. Results appear below as soon as they are saved.</p>}
    </Panel>
    <Panel title="Recent results" hint="Newest first">
      {checks.length === 0 ? <EmptyState title="No checks recorded yet">{available ? "Results appear here with a clear positive, negative or needs-attention message." : "Results will appear here once the database update is applied."}</EmptyState>
        : <ul className="result-feed">{checks.map((check) => <li key={check.id} className={`tone-${check.tone}`}><span className="result-dot" aria-hidden /><div><strong>{check.message}</strong><p><Link href={`/dashboard/posts/${check.publication_id}`}>{titles.get(check.publication_id) || "Open post"}</Link>{check.notes && <> · <span className="muted">{check.notes}</span></>}</p></div><time dateTime={check.checked_at}>{formatTime(check.checked_at, zone)}</time></li>)}</ul>}
    </Panel>
  </>;
}
