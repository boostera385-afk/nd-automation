import Link from "next/link";
import { ClipboardList, Clock3, CircleCheck, TriangleAlert } from "lucide-react";
import { getContext, getDashboardData } from "@/lib/data";
import { getOperationsData } from "@/lib/operations-data";
import { heartbeatState } from "@/lib/workflow";
import { sheetSyncConfigured } from "@/lib/sheet-sync";
import { createWorkspace } from "@/app/actions/reporting";
import { ActionForm } from "@/components/action-form";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader, Panel, StatCard } from "@/components/ui";
import { PublicationTable } from "@/components/publication-table";
import { profileDayBoard, windowLabel } from "@/lib/daily-board";
import { formatTime } from "@/lib/time";

export default async function Home() {
  const { organization, isStaff } = await getContext();
  if (!organization) return <>
    <PageHeader eyebrow="WELCOME" title="Finish your account setup" description="Your verified email works in Fudge and this dashboard. Keep your existing Sheet and Fudge setup unchanged." />
    <Panel title="Your business account"><p>If you belong to an existing team, ask its owner for access instead of creating a duplicate. Otherwise, the button below creates your empty private business account. No reviews are imported and no automation starts.</p><ActionForm action={createWorkspace} label="Set up my private business account"><input type="hidden" name="name" value="My business" /></ActionForm></Panel>
  </>;
  const data = await getDashboardData();
  const operations = isStaff ? await getOperationsData() : null;
  const jobs = operations?.jobs ?? [];
  const enabledWorkers = operations?.workers.filter((worker) => worker.enabled) ?? [];
  const recent = enabledWorkers.filter((worker) => heartbeatState(worker, operations?.loadedAt) === "Seen recently").length;
  const issues = data.publications.filter((post) => post.last_check_outcome && !["alive"].includes(post.last_check_outcome));
  const configured = isStaff && sheetSyncConfigured(organization.id);
  const now = new Date().getTime();
  const board = profileDayBoard({ publications: data.publications, comments: data.comments, customers: data.customers, now });
  return <>
    <PageHeader eyebrow="SHEET → AUTOMATION → RESULTS" title="Home" description="Your connections, recent work and anything that needs attention." actions={isStaff ? <Link className="button" href="/dashboard/run">Run automation</Link> : <Link className="button" href="/dashboard/results">View results</Link>} />
    {isStaff && <>
      <div className="connection-grid">
        <Link className="connection-card" href="/dashboard/master-sheet"><span className="muted small">MASTER SHEET</span><strong>{configured ? "Connection configured" : "Connect once"}</strong><small>{configured ? "Open to read and check your tabs" : "Your existing Sheet stays unchanged"}</small></Link>
        <Link className="connection-card" href="/dashboard/settings#connections"><span className="muted small">LOCAL AUTOMATION AGENT</span><strong>{recent ? `${recent} seen recently` : enabledWorkers.length ? "Waiting for agent" : "Register once"}</strong><small>A heartbeat is not a browser-readiness check</small></Link>
        <Link className="connection-card" href="/dashboard/profiles"><span className="muted small">PROFILES</span><strong>{operations?.available ? `${operations.bindings.length} saved mappings` : "Not loaded"}</strong><small>Choose customers once, reuse for Sheet sync</small></Link>
      </div>
      <div className="stats-grid">{[
        { label: "Checks waiting", value: operations?.available ? jobs.filter((job) => job.status === "pending").length : "—", hint: "Recent monitoring queue", icon: ClipboardList },
        { label: "Checks running", value: operations?.available ? jobs.filter((job) => job.status === "leased").length : "—", hint: "Includes expired leases needing review", icon: Clock3 },
        { label: "Checks finished", value: operations?.available ? jobs.filter((job) => job.status === "completed").length : "—", hint: "Recent monitoring jobs", icon: CircleCheck },
        { label: "Needs attention", value: issues.length, hint: "Saved check problems; not inferred removals", icon: TriangleAlert },
      ].map((item) => <StatCard key={item.label} {...item} />)}</div>
      {!operations?.available && <p className="notice">Local automation status is not available yet. <Link href="/dashboard/settings#connections">Complete one-time setup</Link>.</p>}
      <Panel title="Your daily workflow"><div className="workflow-steps"><Link href="/dashboard/master-sheet"><span>1</span><strong>Master Sheet</strong><small>Clean rows in your usual Sheet, then sync known post links.</small></Link><Link href="/dashboard/run"><span>2</span><strong>Run automation</strong><small>Enable a monitoring batch during your work session.</small></Link><Link href="/dashboard/results"><span>3</span><strong>Review results</strong><small>See saved links, checks and comments. Handle exceptions only.</small></Link></div><p className="small muted">Posting and account creation are still gated. Profile creation, preset inventory and local cookie/proxy checks can be queued from Run automation. Fudge stays separate. No browser task starts when you open the dashboard. <Link href="/dashboard/settings/guide">Open the first-time setup &amp; how-to guide</Link>.</p></Panel>
      <Panel title="Last 24 hours by profile" hint={windowLabel(now, organization.time_zone)}>
        {board.length === 0 ? <p>No tracked post or saved comment is loaded yet. Sync post links and run a check batch to fill this board.</p> : <div className="table-wrap"><table><thead><tr><th>Profile</th><th>Customer</th><th>Posts (24h)</th><th>Comments (24h)</th><th>Last comment seen</th><th></th></tr></thead><tbody>{board.filter((row) => row.posts24h + row.comments24h > 0).slice(0, 24).map((row) => <tr key={row.profile}><td>{row.profile}</td><td>{row.customer}</td><td>{row.posts24h}</td><td>{row.comments24h}</td><td>{row.lastObservedAt ? formatTime(row.lastObservedAt, organization.time_zone) : "Not observed"}</td><td><Link className="text-link" href={`/dashboard/responses?profile=${encodeURIComponent(row.profile)}`}>Open</Link></td></tr>)}</tbody></table></div>}
        <p className="small"><Link className="text-link" href="/dashboard/responses">All loaded profiles and posts →</Link></p>
        <p className="muted small">Counts only: saved posts recorded in this rolling window and saved comments first observed in it, busiest first. No comment thread opens here — opening a profile moves you to Responses. A profile with no saved activity in the window is left off this list, not counted as zero on Nextdoor. {data.truncated && "Loaded records are partial, so these counts are partial too."}</p>
      </Panel>
    </>}
    {(data.truncated || operations?.limited) && <p className="notice">This summary uses limited loaded records (latest 100 monitoring jobs). Counts are partial, not all-time totals.</p>}
    <Panel title="Latest saved results" hint="Submission and visibility are separate"><PublicationTable publications={data.publications.slice(0, 6)} customers={data.customers} zone={organization.time_zone} /><p><Link className="text-link" href="/dashboard/results">All results →</Link></p></Panel>
    <details className="workflow-details"><summary>Refresh & status details</summary><LiveRefresh /><p className="muted small">Sheet configuration does not prove it is reachable. Worker heartbeats do not prove Incogniton is ready. Visibility describes the saved observation time, not guaranteed current status. Result writeback to the Sheet is not connected yet.</p></details>
  </>;
}
