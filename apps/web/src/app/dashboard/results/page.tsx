import Link from "next/link";
import { z } from "zod";
import { requireWorkspace, getDashboardData } from "@/lib/data";
import { businessDate, isInDay, shiftDay, formatTime } from "@/lib/time";
import { filterPublications, parseFilters } from "@/lib/filters";
import { getRecentChecks } from "@/lib/checks-data";
import { PageHeader, Panel, OutcomeBadge } from "@/components/ui";
import { PublicationTable } from "@/components/publication-table";
import { LiveRefresh } from "@/components/live-refresh";

export default async function Results({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organization, isStaff } = await requireWorkspace();
  const params = await searchParams;
  const view = z.enum(["posts", "checks", "comments", "problems"]).safeParse(params.view);
  const selected = view.success ? view.data : "posts";
  const period = z.enum(["all", "today", "yesterday"]).safeParse(params.period);
  const selectedPeriod = period.success ? period.data : "all";
  const [data, recent] = await Promise.all([getDashboardData(), getRecentChecks()]);
  const today = businessDate(new Date(), organization.time_zone);
  const day = selectedPeriod === "yesterday" ? shiftDay(today, -1) : today;
  const cohort = data.publications.filter((post) => selectedPeriod === "all" || isInDay(post.published_at, day, organization.time_zone));
  const filters = parseFilters(params, data.customers);
  const filtered = filterPublications(cohort, data.customers, filters);
  const visible = selected === "problems" ? filtered.filter((post) => post.last_check_outcome && post.last_check_outcome !== "alive") : filtered;
  const ids = new Set(visible.map((post) => post.id));
  const tabHref = (view: string) => {
    const query = new URLSearchParams({ view, period: selectedPeriod });
    if (filters.q) query.set("q", filters.q);
    if (filters.customer) query.set("customer", filters.customer);
    return `/dashboard/results?${query}`;
  };
  return <>
    <PageHeader eyebrow="SAVED RESULTS" title="Results" description="Post links, visibility checks, comments and problems in one place. Dates use your business timezone." actions={<><Link className="button secondary" href="/dashboard/responses">Responses (24h)</Link><LiveRefresh /></>} />
    <nav className="workflow-tabs" aria-label="Result views">{([['posts', 'Post links'], ['checks', 'Visibility checks'], ['comments', 'Comments'], ['problems', 'Problems']] as const).map(([key, label]) => <Link key={key} href={tabHref(key)} aria-current={key === selected ? "page" : undefined}>{label}</Link>)}</nav>
    <form method="get" className="filter-bar"><input type="hidden" name="view" value={selected} /><label>Period<select name="period" defaultValue={selectedPeriod}><option value="all">All dates (including unknown)</option><option value="today">Today</option><option value="yesterday">Yesterday</option></select></label><label>Search<input name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="Post, profile or customer" /></label><label>Customer<select name="customer" defaultValue={filters.customer}><option value="">All assigned customers</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><button className="button secondary">Apply</button></form>
    {data.truncated && <p className="notice">Loaded posts/comments are partial. Counts and filters apply only to loaded records.</p>}
    {selectedPeriod !== "all" && <p className="muted small">Rows with unknown publication dates stay under All dates, not guessed into Today or Yesterday. Comment/check views filter by the selected publication cohort.</p>}
    {(selected === "posts" || selected === "problems") && <Panel title={selected === "problems" ? "Saved check problems" : "Recorded publications"}><PublicationTable publications={visible} customers={data.customers} zone={organization.time_zone} /></Panel>}
    {selected === "checks" && <Panel title="Recent visibility checks" hint="Latest 60 stored results">{recent.checks.filter((check) => ids.has(check.publication_id)).map((check) => <article className="notice subtle" key={check.id}><Link href={`/dashboard/posts/${check.publication_id}`}>{data.publications.find((post) => post.id === check.publication_id)?.title ?? "Open post"}</Link><p><OutcomeBadge outcome={check.outcome} /> · {check.source === "auto_check" ? "Automatic check" : "Manual review"} · {formatTime(check.checked_at, organization.time_zone)}</p></article>)}{!recent.checks.some((check) => ids.has(check.publication_id)) && <p>No check results in this loaded view. Use Run automation once a monitoring agent is paired.</p>}</Panel>}
    {selected === "comments" && <Panel title="Comments by post" hint="Observed samples may be incomplete">{data.comments.filter((comment) => ids.has(comment.publication_id)).map((comment) => <article key={comment.id} className="notice subtle"><Link href={`/dashboard/posts/${comment.publication_id}`}>{data.publications.find((post) => post.id === comment.publication_id)?.title ?? "Open post"}</Link><p><strong>{comment.author_label}</strong></p><p className="content-body">{comment.body}</p><small>First seen {formatTime(comment.first_observed_at, organization.time_zone)} · {comment.source === "auto_check" ? "Automatic sample" : "Manual record"}</small></article>)}{!data.comments.some((comment) => ids.has(comment.publication_id)) && <p>No comments saved in this view. No count is inferred from account unread badges.</p>}</Panel>}
    <details className="workflow-details"><summary>More / manual fallback</summary><div className="workflow-links"><Link href="/dashboard/reports">Advanced reports</Link><Link href="/dashboard/posts">Detailed post ledger</Link>{isStaff && <><Link href="/dashboard/posts/new">Add a missing link manually</Link><Link href="/dashboard/checks">Record manual checks</Link></>}</div></details>
  </>;
}
