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
import { ComputerControls } from "@/components/computer-controls";
import { hasActiveSession } from "@/lib/active-session";
import { randomUUID } from "node:crypto";
import { BulkIntakeForm } from "@/components/bulk-intake-form";
import { canManageSetup } from "@/lib/setup-access";

export default async function RunAutomation() {
  const { organization, membership } = await requireWorkspace(true);
  const manageSetup = canManageSetup(membership?.role);
  const [operations, data] = await Promise.all([getOperationsData(), getDashboardData()]);
  const activeSession = hasActiveSession(data.session, operations.loadedAt);
  const profiles = operations.bindings.map((binding) => {
    const worker = operations.workers.find((item) => item.id === binding.worker_id);
    return { id: binding.id, label: binding.account_label, customer: data.customers.find((customer) => customer.id === binding.customer_id)?.name ?? "Assigned customer", worker: worker?.name ?? "Assigned device", enabled: Boolean(worker?.enabled), monitoring: Boolean(activeSession && binding.monitoring_session_id === data.session?.id && worker?.enabled), posts: data.publications.filter((post) => post.customer_id === binding.customer_id && post.account_label === binding.account_label).length };
  });
  const health = operations.bindings.map((binding) => profileHealth({ binding, worker: operations.workers.find((item) => item.id === binding.worker_id), jobs: operations.jobs, sessionId: activeSession ? data.session?.id ?? null : null, now: operations.loadedAt }));
  const healthTotals = healthSummary(health);
  return <>
    <PageHeader eyebrow="DAILY CONTROL" title="Run automation" description="Choose your work. Technical connection and recovery details stay out of your daily flow." actions={<LiveRefresh />} />
    <Panel title="Open & connect"><ComputerControls workers={operations.workers} activeSession={activeSession} available={operations.automationAvailable} manageSetup={manageSetup} /></Panel>
    <Panel title="Choose your work"><div className="workflow-links">
      <Link href="/dashboard/content"><strong>Posts &amp; listings</strong><small>Prepare content, review attachments and approve the exact revision before publishing.</small></Link>
      <Link href="/dashboard/workflows"><strong>Account tools &amp; editing</strong><small>Authorized login/inspection, genuine-data signup handoff, exact-target editing and confirmed deletion/blocking.</small></Link>
      <Link href="/dashboard/profiles"><strong>Profiles</strong><small>{manageSetup ? "Detect your profile list and save customer assignments once." : "View shared profiles and saved customer assignments."}</small></Link>
      <Link href="/dashboard/results"><strong>Post status &amp; comments</strong><small>See saved observations, check times and issues. An unchecked post is not live or deleted.</small></Link>
      <Link href="/dashboard/master-sheet"><strong>Master Sheet</strong><small>Keep your existing Sheet workflow and sync known post links.</small></Link>
    </div><p className="small muted">Publishing and account actions use separate reviewed local adapters and explicit authorization. These links do not start a browser or claim that real-platform acceptance is complete.</p></Panel>
    <Panel title="One-click prior-day cohort"><p>Choose an exact customer/publication date and follow every tracked record, including skipped and blocked cases. Setup and session authorization are checked separately.</p><Link className="button secondary" href="/dashboard/run/cohorts">Refresh post statuses by date</Link></Panel>
    <Panel title="Post checks & comments" hint="Available with the local monitoring agent">
      <p>After syncing reported links from Master Sheet, enable checks for selected profiles. Your local agent checks older or unknown-date posts due for review. One batch confirmation replaces repeated profile-by-profile setup.</p>
      {!operations.available || profiles.length === 0 ? <p>Start this device&apos;s automation agent and <Link href="/dashboard/profiles">assign profiles</Link> first. <Link href="/dashboard/settings#connections">Open one-time setup</Link>.</p> : <MonitoringBatch profiles={profiles} activeSession={Boolean(activeSession)} />}
      {(operations.limited || data.truncated) && <p className="notice">Loaded records are partial. Profile/post counts describe only this view.</p>}
    </Panel>
    <details className="workflow-details"><summary>Advanced imports, connection health &amp; recovery</summary>
    <Panel title="Protected bulk intake"><BulkIntakeForm workers={operations.workers} request={randomUUID()} /></Panel>
    <Panel title="Profile & session health" hint="Read-only status from the last agent heartbeat">
      {operations.bindings.length === 0 ? <p>No profiles are assigned yet. <Link href="/dashboard/profiles">Assign profiles</Link> to see their status here.</p> : <>
        <p className="small">{healthTotals.live} live · {healthTotals.stale} stale · {healthTotals.offline} offline · {healthTotals.disabled} disabled · {healthTotals.monitored} bound to the current session.{" "}{healthTotals.expiredLeases > 0 ? `${healthTotals.expiredLeases} lease(s) expired and need review.` : "No expired leases."}</p>
        <div className="table-wrap"><table><thead><tr><th>Profile</th><th>Customer</th><th>Device</th><th>Agent</th><th>Session</th><th>Leased jobs</th></tr></thead><tbody>{operations.bindings.map((binding, index) => { const item = health[index]; return <tr key={binding.id}><td>{binding.account_label}</td><td>{data.customers.find((customer) => customer.id === binding.customer_id)?.name ?? "Assigned customer"}</td><td>{item.workerName}</td><td><span className={item.tone === "neutral" ? "badge" : `badge tone-${item.tone}`}>{healthLabels[item.level]}</span><small>Last heartbeat {item.heartbeat}</small></td><td>{item.monitored ? "Bound to session" : "Not in session"}</td><td>{item.workerLeases}{item.expiredLeases > 0 && <small>{item.expiredLeases} expired — needs review</small>}</td></tr>; })}</tbody></table></div>
        <p className="muted small">This panel reads stored heartbeat and lease records only. It does not probe Incogniton, open a browser or start a check. Launching, stopping or repairing a profile happens in Incogniton on this device.</p>
      </>}
    </Panel>
    <Panel title="Recent check progress" hint="Latest 10 of the loaded monitoring jobs">
      {operations.jobs.length ? <div className="table-wrap"><table><thead><tr><th>Post</th><th>Device</th><th>State</th><th>Outcome</th></tr></thead><tbody>{operations.jobs.slice(0, 10).map((job) => <tr key={job.id}><td><Link href={`/dashboard/posts/${job.publication_id}`}>{data.publications.find((post) => post.id === job.publication_id)?.title ?? "Open post"}</Link></td><td>{operations.workers.find((worker) => worker.id === job.worker_id)?.name ?? "Assigned device"}</td><td>{job.status}{job.status === "leased" && job.lease_expires_at && <small>{Date.parse(job.lease_expires_at) < operations.loadedAt ? "Expired — needs review" : "Lease deadline"}: {formatTime(job.lease_expires_at, organization.time_zone)}</small>}</td><td>{job.outcome ?? "No result yet"}</td></tr>)}</tbody></table></div> : <p>No monitoring jobs are loaded. Enabling a batch authorizes the local agent to plan due checks; it does not manufacture results.</p>}
      <p className="small"><Link href="/dashboard/results?view=checks">Saved check results</Link> · <Link href="/dashboard/automation">Advanced recovery</Link></p>
    </Panel>
    <Panel title="Browser tasks" hint="Queued for this device's automation agent — nothing runs in this tab">
      <BrowserTasks workers={operations.workers} tasks={operations.tasks} profiles={operations.profiles} timeZone={organization.time_zone} available={operations.automationAvailable} activeSession={Boolean(activeSession)} />
      {operations.tasksLimited && <p className="notice">Showing the 20 most recent tasks only.</p>}
    </Panel>
    <Panel title="Execution boundaries" hint="Source functionality is not live acceptance"><div className="task-list">{gatedTasks.map((task) => <div className="task-row" key={task.label}><div><strong>{task.label}</strong><small className="muted">{task.reason}</small></div><span className="badge">Gated</span></div>)}</div><p className="muted small">Use the separate task-specific controls above. Cookie/proxy writes remain one profile per task, explicitly confirmed and not live-accepted. Artificial engagement and deceptive warmup remain disabled.</p></Panel>
    </details>
  </>;
}
