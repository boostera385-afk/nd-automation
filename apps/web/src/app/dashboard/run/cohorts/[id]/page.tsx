import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCohortReport } from "@/lib/cohort-data";
import { cohortProgress } from "@/lib/check-cohort";
import { formatTime } from "@/lib/time";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader, Panel } from "@/components/ui";

const labels = { queued: "New job queued", active_job: "Existing job reused", recent: "Recent saved check (not run again)", unsupported_link: "Unsupported exact worker URL", not_authorized: "Profile not authorized in this session", worker_unavailable: "Worker disabled/unavailable" };

export default async function CheckCohort({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id } = await params;
  const result = await loadCohortReport(id);
  if (!result.available) return <Panel title="Cohort unavailable"><p>The saved snapshot or current job states could not be verified. Nothing was queued or retried.</p><Link href="/dashboard/run/cohorts">Back to saved requests</Link></Panel>;
  if (!result.report) notFound();
  const report = result.report;
  const progress = cohortProgress(report);
  const pages = Math.max(1, Math.ceil(report.items.length / 25));
  const requested = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(requested) ? Math.min(pages, Math.max(1, requested)) : 1;
  const items = report.items.slice((page - 1) * 25, page * 25);
  return <>
    <PageHeader eyebrow="FROZEN PUBLICATION COHORT" title={`${report.receipt.day} · ${report.receipt.kind}`} description={`${report.receipt.timeZone} · policy v1 · saved ${formatTime(report.createdAt, report.receipt.timeZone)}`} actions={<LiveRefresh />} />
    <Panel title="Exact saved membership and progress">
      <p>{report.receipt.total} tracked · {progress.waiting} waiting · {progress.running} running · {progress.checked} completed checks · {progress.recent} recent results · {progress.blocked} blocked · {progress.cancelled} cancelled · {progress.attention} need attention (may overlap completed checks).</p>
      <p>{report.receipt.total - progress.checked - progress.recent} not completed/reconciled. {report.receipt.unknownDates} unknown-date records were excluded, not substituted. Missing links outside the ledger remain unknown.</p>
      <p className="small">Results are saved observations, not guaranteed live visibility. Expired leases require operator reconciliation, never automatic browser retry. Comments may be partial. Refreshing this view only reads state; no Sheet delivery is active.</p>
    </Panel>
    <Panel title="Per-publication disposition" hint={`Page ${page} of ${pages}; 25 records per page`}>
      <div className="table-wrap"><table><thead><tr><th>Exact publication</th><th>Account</th><th>Disposition</th><th>Current job</th><th>Result / time</th></tr></thead><tbody>{items.map((item) => <tr key={item.publicationId}>
        <td><Link href={`/dashboard/posts/${item.publicationId}`}>{item.publicationId}</Link><small>{item.url}</small></td><td>{item.accountLabel}</td><td>{labels[item.disposition]}</td>
        <td>{item.status ?? "No new job"}{item.jobId && <small>{item.jobId}</small>}</td>
        <td>{item.outcome ?? item.recentOutcome ?? "No result"}<small>{item.completedAt ? `Server completed: ${formatTime(item.completedAt, report.receipt.timeZone)}` : item.recentCheckedAt ? `Previous check: ${formatTime(item.recentCheckedAt, report.receipt.timeZone)}` : "Observation time unknown"}</small></td>
      </tr>)}</tbody></table></div>
      <nav aria-label="Cohort record pages">{page > 1 && <Link className="button secondary" href={`?page=${page - 1}`}>Previous</Link>}{page < pages && <Link className="button secondary" href={`?page=${page + 1}`}>Next</Link>}</nav>
    </Panel>
    <Link href="/dashboard/run/cohorts">Saved requests / new reviewed cohort</Link>
  </>;
}
