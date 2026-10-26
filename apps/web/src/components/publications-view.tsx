import Link from "next/link";
import { Search } from "lucide-react";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { filterPublications, hasFilters, parseFilters, type SearchParams } from "@/lib/filters";
import { businessDate, isInDay, shiftDay } from "@/lib/time";
import { visibilitySchema } from "@/lib/validation";
import { PageHeader, Panel, visibilityLabels } from "./ui";
import { PublicationTable } from "./publication-table";

const routes = { all: "/dashboard/posts", today: "/dashboard/today", yesterday: "/dashboard/yesterday" } as const;

export async function PublicationsView({ period, params = {} }: { period: "today" | "yesterday" | "all"; params?: SearchParams }) {
  const { organization, isStaff } = await requireWorkspace();
  const { publications, customers, truncated } = await getDashboardData();
  const today = businessDate(new Date(), organization.time_zone);
  const day = period === "yesterday" ? shiftDay(today, -1) : today;
  const inPeriod = period === "all" ? publications : publications.filter((post) => isInDay(post.published_at, day, organization.time_zone));
  const filters = parseFilters(params, customers);
  const filtered = hasFilters(filters);
  const rows = filterPublications(inPeriod, customers, filters);
  return <><PageHeader title={period === "all" ? "All posts" : period === "today" ? "Today’s post records" : "Yesterday’s post records"} description={period === "all" ? "Authorized links and sourced observations. Nothing here publishes or automatically checks a platform." : `${day} · ${organization.time_zone}. Publication date and work-session date are separate.`} actions={<>{inPeriod.length > 0 && <a className="button secondary" href="/dashboard/export/posts">Export CSV</a>}{isStaff && <Link className="button" href="/dashboard/posts/new">Record a post</Link>}</>} />{truncated && <p className="notice">Loaded-data limit reached. These summaries are partial; full server pagination is a later milestone.</p>}{inPeriod.length > 0 && <form method="get" action={routes[period]} role="search" className="filter-bar"><label className="search-field"><span>Search</span><span className="search-input"><Search size={16} aria-hidden /><input type="search" name="q" defaultValue={filters.q} maxLength={100} placeholder="Title, account, link or customer" /></span></label><label>Observation<select name="visibility" defaultValue={filters.visibility ?? ""}><option value="">Any observation</option>{visibilitySchema.options.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}</select></label>{customers.length > 1 && <label>Customer<select name="customer" defaultValue={filters.customer}><option value="">All customers</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}<div className="filter-actions"><button className="button secondary" type="submit">Apply filters</button>{filtered && <Link className="text-link" href={routes[period]}>Clear</Link>}</div></form>}<Panel title={filtered ? `${rows.length} of ${inPeriod.length} records` : `${rows.length} records`} hint="Visibility is a timestamped manual observation, not a current live guarantee."><PublicationTable publications={rows} customers={customers} zone={organization.time_zone} emptyTitle={filtered ? "No records match these filters" : undefined} emptyText={filtered ? "Try a different search term or clear the filters to see every record in this view." : undefined} /></Panel></>;
}
