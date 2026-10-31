import Link from "next/link";
import { requireWorkspace, getDashboardData } from "@/lib/data";
import { getOperationsData } from "@/lib/operations-data";
import { PageHeader, Panel } from "@/components/ui";
import { MonitoringBatch } from "@/components/monitoring-batch";
import { BrowserTasks } from "@/components/browser-tasks";
import { LiveRefresh } from "@/components/live-refresh";
import { gatedTasks } from "@/lib/automation-tasks";
import { healthLabels, healthSummary, profileHealth } from "@/lib/profile-health";
import { formatTime } from "@/lib/time";

export default async function RunAutomation() {
  const { organization } = await requireWorkspace(true);
  const [operations, data] = await Promise.all([getOperationsData(), getDashboardData()]);
  const activeSession = data.session?.status === "active" && operations.loadedAt - Date.parse(data.session.started_at) < 10 * 3600_000;
  const profiles = operations.bindings.map((binding) => {
    const worker = operations.workers.find((item) => item.id === binding.worker_id);
    return { id: binding.id, label: binding.account_label, customer: data.customers.find((customer) => customer.id === binding.customer_id)?.name ?? "Assigned customer", worker: worker?.name ?? "Assigned laptop", enabled: Boolean(worker?.enabled), monitoring: Boolean(activeSession && binding.monitoring_session_id === data.session?.id && worker?.enabled), posts: data.publications.filter((post) => post.customer_id === binding.customer_id && post.account_label === binding.account_label).length };
  });
  const health = operations.bindings.map((binding) => profileHealth({ binding, worker: operations.workers.find((item) => item.id === binding.worker_id), jobs: operations.jobs, sessionId: activeSession ? data.session?.id ?? null : null, now: operations.loadedAt }));
  const healthTotals = healthSummary(health);
  return <>
    <PageHeader eyebrow="DAILY CONTROL" title="Run automation" description="Use your saved profiles and master-Sheet records. Select a batch once; review progress in Results." actions={<LiveRefresh />} />
    <Panel title="One-click prior-day cohort"><p>Choose an exact customer/publication date and follow every tracked record, including skipped and blocked cases. Setup and session authorization are checked separately.</p><Link className="button secondary" href="/dashboard/run/cohorts">Refresh post statuses by date</Link></Panel>
    <Panel title="Post checks & comments" hint="Available with a paired monitoring agent">
      <p>After syncing reported links from Master Sheet, enable checks for selected profiles. Your local agent checks older or unknown-date posts due for review. One batch confirmation replaces repeated profile-by-profile setup.</p>
      {!operations.available || profiles.length === 0 ? <p>Connect your laptop and <Link href="/dashboard/profiles">assign profiles</Link> first. <Link href="/dashboard/settings#connections">Open one-time setup</Link>.</p> : <MonitoringBatch profiles={profiles} activeSession={Boolean(activeSession)} />}
      {(operations.limited || data.truncated) && <p className="notice">Loaded records are partial. Profile/post counts describe only this view.</p>}
    </Panel>
    <Panel title="Profile & session health" hint="Read-only status from the last agent heartbeat">
      {operations.bindings.length === 0 ? <p>No profiles are assigned yet. <Link href="/dashboard/profiles">Assign profiles</Link> to see their status here.</p> : <>
        <p className="small">{healthTotals.live} live · {healthTotals.stale} stale · {healthTotals.offline} offline · {healthTotals.disabled} disabled · {healthTotals.monitored} bound to the current session.{" "}{healthTotals.expiredLeases > 0 ? `${healthTotals.expiredLeases} lease(s) expired and need review.` : "No expired leases."}</p>
        <div className="table-wrap"><table><thead><tr><th>Profile</th><th>Customer</th><th>Laptop</th><th>Agent</th><th>Session</th><th>Leased jobs</th></tr></thead><tbody>{operations.bindings.map((binding, index) => { const item = health[index]; return <tr key={binding.id}><td>{binding.account_label}</td><td>{data.customers.find((customer) => customer.id === binding.customer_id)?.name ?? "Assigned customer"}</td><td>{item.workerName}</td><td><span className={item.tone === "neutral" ? "badge" : `badge tone-${item.tone}`}>{healthLabels[item.level]}</span><small>Last heartbeat {item.heartbeat}</small></td><td>{item.monitored ? "Bound to session" : "Not in session"}</td><td>{item.workerLeases}{item.expiredLeases > 0 && <small>{item.expiredLeases} expired — needs review</small>}</td></tr>; })}</tbody></table></div>
        <p className="muted small">This panel reads stored heartbeat and lease records only. It does not probe Incogniton, open a browser or start a check. Launching, stopping or repairing a profile still happens in the desktop app.</p>
      </>}
    </Panel>
    <Panel title="Recent check progress" hint="Latest 10 of the loaded monitoring jobs">
      {operations.jobs.length ? <div className="table-wrap"><table><thead><tr><th>Post</th><th>Laptop</th><th>State</th><th>Outcome</th></tr></thead><tbody>{operations.jobs.slice(0, 10).map((job) => <tr key={job.id}><td><Link href={`/dashboard/posts/${job.publication_id}`}>{data.publications.find((post) => post.id === job.publication_id)?.title ?? "Open post"}</Link></td><td>{operations.workers.find((worker) => worker.id === job.worker_id)?.name ?? "Assigned laptop"}</td><td>{job.status}{job.status === "leased" && job.lease_expires_at && <small>{Date.parse(job.lease_expires_at) < operations.loadedAt ? "Expired — needs review" : "Lease deadline"}: {formatTime(job.lease_expires_at, organization.time_zone)}</small>}</td><td>{job.outcome ?? "No result yet"}</td></tr>)}</tbody></table></div> : <p>No monitoring jobs are loaded. Enabling a batch authorizes the paired agent to plan due checks; it does not manufacture results.</p>}
      <p className="small"><Link href="/dashboard/results?view=checks">Saved check results</Link> · <Link href="/dashboard/automation">Advanced recovery</Link></p>
    </Panel>
    <Panel title="Browser tasks" hint="Queued for the paired laptop — nothing runs in this tab">
      <BrowserTasks workers={operations.workers} tasks={operations.tasks} profiles={operations.profiles} timeZone={organization.time_zone} available={operations.automationAvailable} />
      {operations.tasksLimited && <p className="notice">Showing the 20 most recent tasks only.</p>}
    </Panel>
    <Panel title="Still gated" hint="Deliberately not executable from the dashboard"><div className="task-list">{gatedTasks.map((task) => <div className="task-row" key={task.label}><div><strong>{task.label}</strong><small className="muted">{task.reason}</small></div><span className="badge">Gated</span></div>)}</div><p className="muted small">These rows are not coming soon: each needs its own approval and a live test before any Start button exists. Cookie and proxy imports above are the real thing now — one profile per task, confirmed by you each time, and not yet verified against a live Incogniton install, so a first run may report a failure honestly.</p></Panel>
  </>;
}
