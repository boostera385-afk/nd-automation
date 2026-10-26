import Link from "next/link";
import { Download } from "lucide-react";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { businessDate, dayRange, shiftDay } from "@/lib/time";
import { reportSnapshot } from "@/lib/reports";
import { PageHeader, Panel } from "@/components/ui";
import { PublicationTable } from "@/components/publication-table";

export default async function Reports({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { organization } = await requireWorkspace();
  const data = await getDashboardData();
  const params = await searchParams;
  let day = params.day || shiftDay(businessDate(new Date(), organization.time_zone), -1);
  try { if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(); dayRange(day, organization.time_zone); }
  catch { day = shiftDay(businessDate(new Date(), organization.time_zone), -1); }
  const report = reportSnapshot(data.publications, data.comments, day, organization.time_zone);
  return <><PageHeader title="Daily reporting snapshot" description={`Business date ${day} · ${organization.time_zone}. A current snapshot of recorded data, not a historical continuous-monitoring claim.`} actions={!data.truncated && <Link className="button secondary" href={`/dashboard/reports/export?day=${day}`} prefetch={false}><Download size={16} /> Download CSV</Link>} /><form method="get" className="filter-bar"><label>Business date<input type="date" name="day" defaultValue={day} required /></label><button className="button secondary">View snapshot</button></form>{data.truncated && <p className="notice error">Loaded-data limits reached. This snapshot is partial and CSV export is disabled. Full paginated reports are deferred.</p>}<div className="stats-grid"><article className="stat-card"><span>Publication cohort</span><strong>{report.cohort.length}</strong><small>Recorded as published on {day}</small></article><article className="stat-card"><span>Last observed live</span><strong>{report.lastObservedLive}</strong><small>{report.notReviewed} never reviewed · {report.stale} stale observations</small></article><article className="stat-card"><span>Comments with creation date in period</span><strong>{report.commentsCreated}</strong><small>Only where platform creation time is known</small></article><article className="stat-card"><span>Comments first observed in period</span><strong>{report.commentsFirstObserved}</strong><small>Separate from platform creation counts</small></article></div><div className="notice subtle"><strong>Coverage and limitations</strong><p>{report.unknownDates} post records have unknown publication dates and are excluded from day cohorts. No automated checking, overnight collection, report email delivery or immutable report archive is enabled in this milestone. Snapshot counts reflect only stored, accessible records.</p></div><Panel title="Publications in the selected day"><PublicationTable publications={report.cohort} customers={data.customers} zone={organization.time_zone} /></Panel></>;
}
