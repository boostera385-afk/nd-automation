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

export default async function Home() {
  const { organization, isStaff } = await getContext();
  if (!organization) return <>
    <PageHeader eyebrow="WELCOME" title="Your automation workspace" description="Keep your master Sheet and desktop setup. Connect them here once; do not rebuild your data by hand." />
    <Panel title="Workspace access"><p>If your team already has a workspace, ask its owner for access rather than creating a duplicate. Otherwise create an empty workspace below.</p><ActionForm action={createWorkspace} label="Create workspace"><label>Workspace name<input name="name" minLength={2} maxLength={100} required autoComplete="organization" /></label></ActionForm></Panel>
  </>;
  const data = await getDashboardData();
  const operations = isStaff ? await getOperationsData() : null;
  const jobs = operations?.jobs ?? [];
  const enabledWorkers = operations?.workers.filter((worker) => worker.enabled) ?? [];
  const recent = enabledWorkers.filter((worker) => heartbeatState(worker, operations?.loadedAt) === "Seen recently").length;
  const issues = data.publications.filter((post) => post.last_check_outcome && !["alive"].includes(post.last_check_outcome));
  const configured = isStaff && sheetSyncConfigured(organization.id);
  return <>
    <PageHeader eyebrow="SHEET → AUTOMATION → RESULTS" title="Home" description="Your connections, recent work and anything that needs attention." actions={isStaff ? <Link className="button" href="/dashboard/run">Run automation</Link> : <Link className="button" href="/dashboard/results">View results</Link>} />
    {isStaff && <>
      <div className="connection-grid">
        <Link className="connection-card" href="/dashboard/master-sheet"><span className="muted small">MASTER SHEET</span><strong>{configured ? "Connection configured" : "Connect once"}</strong><small>{configured ? "Open to read and check your tabs" : "Your existing Sheet stays unchanged"}</small></Link>
        <Link className="connection-card" href="/dashboard/settings#connections"><span className="muted small">LOCAL LAPTOP</span><strong>{recent ? `${recent} seen recently` : enabledWorkers.length ? "Waiting for worker" : "Pair once"}</strong><small>A heartbeat is not a browser-readiness check</small></Link>
        <Link className="connection-card" href="/dashboard/profiles"><span className="muted small">PROFILES</span><strong>{operations?.available ? `${operations.bindings.length} saved mappings` : "Not loaded"}</strong><small>Choose customers once, reuse for Sheet sync</small></Link>
      </div>
      <div className="stats-grid">{[
        { label: "Checks waiting", value: operations?.available ? jobs.filter((job) => job.status === "pending").length : "—", hint: "Recent monitoring queue", icon: ClipboardList },
        { label: "Checks running", value: operations?.available ? jobs.filter((job) => job.status === "leased").length : "—", hint: "Includes expired leases needing review", icon: Clock3 },
        { label: "Checks finished", value: operations?.available ? jobs.filter((job) => job.status === "completed").length : "—", hint: "Recent monitoring jobs", icon: CircleCheck },
        { label: "Needs attention", value: issues.length, hint: "Saved check problems; not inferred removals", icon: TriangleAlert },
      ].map((item) => <StatCard key={item.label} {...item} />)}</div>
      {!operations?.available && <p className="notice">Local automation status is not available yet. <Link href="/dashboard/settings#connections">Complete one-time setup</Link>.</p>}
      <Panel title="Your daily workflow"><div className="workflow-steps"><Link href="/dashboard/master-sheet"><span>1</span><strong>Master Sheet</strong><small>Clean rows in your usual Sheet, then sync known post links.</small></Link><Link href="/dashboard/run"><span>2</span><strong>Run automation</strong><small>Enable a monitoring batch during your work session.</small></Link><Link href="/dashboard/results"><span>3</span><strong>Review results</strong><small>See saved links, checks and comments. Handle exceptions only.</small></Link></div><p className="small muted">Posting and profile/account creation still run in your desktop app. Fudge stays separate. No browser task starts when you open the dashboard.</p></Panel>
    </>}
    {(data.truncated || operations?.limited) && <p className="notice">This summary uses limited loaded records (latest 100 monitoring jobs). Counts are partial, not all-time totals.</p>}
    <Panel title="Latest saved results" hint="Submission and visibility are separate"><PublicationTable publications={data.publications.slice(0, 6)} customers={data.customers} zone={organization.time_zone} /><p><Link className="text-link" href="/dashboard/results">All results →</Link></p></Panel>
    <details className="workflow-details"><summary>Refresh & status details</summary><LiveRefresh /><p className="muted small">Sheet configuration does not prove it is reachable. Worker heartbeats do not prove Incogniton is ready. Visibility describes the saved observation time, not guaranteed current status. Result writeback to the Sheet is not connected yet.</p></details>
  </>;
}
