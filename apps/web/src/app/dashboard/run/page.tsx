import Link from "next/link";
import { requireWorkspace, getDashboardData } from "@/lib/data";
import { getOperationsData } from "@/lib/operations-data";
import { PageHeader, Panel } from "@/components/ui";
import { MonitoringBatch } from "@/components/monitoring-batch";
import { LiveRefresh } from "@/components/live-refresh";
import { formatTime } from "@/lib/time";

export default async function RunAutomation() {
  const { organization } = await requireWorkspace(true);
  const [operations, data] = await Promise.all([getOperationsData(), getDashboardData()]);
  const activeSession = data.session?.status === "active" && operations.loadedAt - Date.parse(data.session.started_at) < 10 * 3600_000;
  const profiles = operations.bindings.map((binding) => {
    const worker = operations.workers.find((item) => item.id === binding.worker_id);
    return { id: binding.id, label: binding.account_label, customer: data.customers.find((customer) => customer.id === binding.customer_id)?.name ?? "Assigned customer", worker: worker?.name ?? "Assigned laptop", enabled: Boolean(worker?.enabled), monitoring: Boolean(activeSession && binding.monitoring_session_id === data.session?.id && worker?.enabled), posts: data.publications.filter((post) => post.customer_id === binding.customer_id && post.account_label === binding.account_label).length };
  });
  return <>
    <PageHeader eyebrow="DAILY CONTROL" title="Run automation" description="Use your saved profiles and master-Sheet records. Select a batch once; review progress in Results." actions={<LiveRefresh />} />
    <Panel title="One-click prior-day cohort"><p>Choose an exact customer/publication date and follow every tracked record, including skipped and blocked cases. Setup and session authorization are checked separately.</p><Link className="button secondary" href="/dashboard/run/cohorts">Refresh post statuses by date</Link></Panel>
    <Panel title="Post checks & comments" hint="Available with a paired monitoring agent">
      <p>After syncing reported links from Master Sheet, enable checks for selected profiles. Your local agent checks older or unknown-date posts due for review. One batch confirmation replaces repeated profile-by-profile setup.</p>
      {!operations.available || profiles.length === 0 ? <p>Connect your laptop and <Link href="/dashboard/profiles">assign profiles</Link> first. <Link href="/dashboard/settings#connections">Open one-time setup</Link>.</p> : <MonitoringBatch profiles={profiles} activeSession={Boolean(activeSession)} />}
      {(operations.limited || data.truncated) && <p className="notice">Loaded records are partial. Profile/post counts describe only this view.</p>}
    </Panel>
    <Panel title="Recent check progress" hint="Latest 10 of the loaded monitoring jobs">
      {operations.jobs.length ? <div className="table-wrap"><table><thead><tr><th>Post</th><th>Laptop</th><th>State</th><th>Outcome</th></tr></thead><tbody>{operations.jobs.slice(0, 10).map((job) => <tr key={job.id}><td><Link href={`/dashboard/posts/${job.publication_id}`}>{data.publications.find((post) => post.id === job.publication_id)?.title ?? "Open post"}</Link></td><td>{operations.workers.find((worker) => worker.id === job.worker_id)?.name ?? "Assigned laptop"}</td><td>{job.status}{job.status === "leased" && job.lease_expires_at && <small>{Date.parse(job.lease_expires_at) < operations.loadedAt ? "Expired — needs review" : "Lease deadline"}: {formatTime(job.lease_expires_at, organization.time_zone)}</small>}</td><td>{job.outcome ?? "No result yet"}</td></tr>)}</tbody></table></div> : <p>No monitoring jobs are loaded. Enabling a batch authorizes the paired agent to plan due checks; it does not manufacture results.</p>}
      <p className="small"><Link href="/dashboard/results?view=checks">Saved check results</Link> · <Link href="/dashboard/automation">Advanced recovery</Link></p>
    </Panel>
    <Panel title="Desktop tasks" hint="Stay in your existing desktop app for now"><div className="task-list">{["Auto Posting", "Auto Listing", "Incog Profile Creation", "ND Acc Creation", "Bulk cookies / proxies import", "Session health / content presets"].map((task) => <div className="task-row" key={task}><strong>{task}</strong><span className="badge">Desktop only</span></div>)}</div><p className="muted small">These browser execution paths are not connected to the dashboard yet. Keep using the desktop app for them; do not run overlapping desktop and worker jobs on the same profile. No placeholder Start buttons are enabled.</p></Panel>
  </>;
}
