import Link from "next/link";
import { requireWorkspace, getDashboardData } from "@/lib/data";
import { isMissingSchemaError } from "@/lib/checks";
import { formatTime } from "@/lib/time";
import { ActionForm } from "@/components/action-form";
import { WorkerRegistration } from "@/components/worker-registration";
import { EmptyState, OutcomeBadge, PageHeader, Panel } from "@/components/ui";
import { bindWorkerProfile, cancelPendingCheck, reassignWorkerProfile, reconcileExpiredCheck, revokeWorker, setProfileMonitoring } from "@/app/actions/workers";

type Worker = { id: string; name: string; enabled: boolean; last_seen_at: string | null };
type Binding = { id: string; worker_id: string; customer_id: string; profile_id: string; account_label: string; monitoring_session_id: string | null };
type Job = { id: string; worker_id: string; publication_id: string; status: string; outcome: string | null; created_at: string; lease_expires_at: string | null };

export default async function Automation() {
  const { db, organization } = await requireWorkspace(true);
  const { customers, publications, session, truncated } = await getDashboardData();
  const [workerQuery, bindingQuery, jobQuery, inventoryQuery] = await Promise.all([
    db.from("reporting_workers").select("id,name,enabled,last_seen_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(101),
    db.from("reporting_worker_profiles").select("id,worker_id,customer_id,profile_id,account_label,monitoring_session_id").eq("organization_id", organization.id).limit(101),
    db.from("reporting_check_jobs").select("id,worker_id,publication_id,status,outcome,created_at,lease_expires_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(101),
    db.from("reporting_profile_inventory").select("profile_id,name,group_name,status").eq("organization_id", organization.id).eq("status", "active").order("name").limit(501),
  ]);
  const errors = [workerQuery.error, bindingQuery.error, jobQuery.error].filter(Boolean);
  if (errors.some((error) => !isMissingSchemaError(error))) throw new Error("Automation records could not be loaded. No jobs were changed.");
  if (inventoryQuery.error && !isMissingSchemaError(inventoryQuery.error)) throw new Error("Profile inventory could not be loaded. No jobs were changed.");
  const available = errors.length === 0;
  const workers = (workerQuery.data || []).slice(0, 100) as Worker[];
  const bindings = (bindingQuery.data || []).slice(0, 100) as Binding[];
  const jobs = (jobQuery.data || []).slice(0, 100) as Job[];
  const limited = truncated || [workerQuery.data, bindingQuery.data, jobQuery.data].some((rows) => (rows?.length || 0) > 100);
  return <>
    <PageHeader eyebrow="LOCAL AUTOMATION" title="Automation control" description="Authorize read-only monitoring on your own laptop. This console does not yet provide publishing, account creation or full desktop parity." actions={<Link className="button secondary" href="/dashboard/checks">Check results</Link>} />
    <div className="notice subtle"><strong>{session?.status === "active" ? "Work session active" : "Work session is not active"}</strong><p>Enable each assigned profile for the current session. A connected agent plans checks for older/unknown-date posts that have not been checked in 24 hours. Pause/End work prevents new claims; an in-flight read may finish. Dispatch expires after ten hours. The laptop and Incogniton must remain available.</p></div>
    {!available ? <Panel title="Worker setup pending"><p>The monitoring-worker database migration has not been applied. Ask your administrator to review and apply <code>202610270002_monitoring_worker_bridge.sql</code> to staging. No browser controls are enabled here until that setup is complete.</p></Panel> : <>
      {limited && <p className="notice">Lists are limited to 100 records per section and may be partial. No overall automation-coverage count is claimed.</p>}
      <Panel title="1. Register a local worker" hint="Private, revocable credential; no service-role key"><WorkerRegistration /></Panel>
      <Panel title="2. Assign an authorized profile" hint="Exact UUID and account label — no guessed profile names">
        {customers.length && workers.some((worker) => worker.enabled) ? <ActionForm action={bindWorkerProfile} label="Assign profile">
          <label>Worker<select name="worker" required>{workers.filter((worker) => worker.enabled).map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
          <label>Customer<select name="customer" required>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label>Exact Incogniton profile UUID<input name="profile" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" list="profile-inventory" /></label>
          <datalist id="profile-inventory">{(inventoryQuery.data ?? []).slice(0, 500).map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{`${profile.name} · ${profile.group_name}`}</option>)}</datalist>
          <p className="muted small">Suggestions come from your <Link href="/dashboard/profiles">profile inventory</Link> and are claims, not live verification. The exact UUID is still required.</p>
          <label>Account label used by this customer’s post records<input name="label" required maxLength={120} /></label>
          <label className="check-label"><input type="checkbox" name="authorized" required />This customer authorizes this exact profile and its read-only post checks.</label>
        </ActionForm> : <EmptyState title="Customer and worker needed">Register a worker and add an authorized customer before assigning profiles.</EmptyState>}
      </Panel>
      <Panel title="3. Enable monitoring for this session" hint="New sessions require a new authorization">
        {bindings.length ? bindings.map((binding) => {
          const active = Boolean(session?.status === "active" && binding.monitoring_session_id === session.id && workers.find((worker) => worker.id === binding.worker_id)?.enabled);
          return <article key={binding.id} className="notice subtle"><strong>{binding.account_label}</strong><p>{customers.find((customer) => customer.id === binding.customer_id)?.name || "Assigned customer"} · {workers.find((worker) => worker.id === binding.worker_id)?.name || "Assigned worker"}</p><p>Profile UUID: <code>{binding.profile_id}</code></p>
            <ActionForm action={setProfileMonitoring} label={active ? "Disable automatic planning" : "Enable read-only monitoring"} secondary>
              <input type="hidden" name="binding" value={binding.id} /><input type="hidden" name="enabled" value={active ? "false" : "true"} />
              {!active && <label className="check-label"><input type="checkbox" name="authorized" required />Authorize checks and partial comment collection during my current work session.</label>}
            </ActionForm>
            {workers.find((worker) => worker.id === binding.worker_id)?.enabled === false && workers.some((worker) => worker.enabled) && <ActionForm action={reassignWorkerProfile} label="Move to replacement worker" secondary>
              <input type="hidden" name="binding" value={binding.id} />
              <label>Replacement worker<select name="replacement" required>{workers.filter((worker) => worker.enabled).map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
              <label className="check-label"><input type="checkbox" name="confirmed" required />The old agent is stopped, the profile is closed, and outstanding leases have been reconciled.</label>
            </ActionForm>}</article>;
        }) : <EmptyState title="No assigned profiles">Assignments are explicit and organization-scoped. Never import cookies or proxy passwords into these forms.</EmptyState>}
      </Panel>
      <Panel title="Workers" hint="Last seen is a heartbeat, not proof a browser is ready">
        {workers.map((worker) => <article className="notice subtle" key={worker.id}><strong>{worker.name} · {worker.enabled ? "Credential enabled" : "Revoked"}</strong><p>Last seen: {worker.last_seen_at ? formatTime(worker.last_seen_at, organization.time_zone) : "Never connected"}</p>{worker.enabled && <ActionForm action={revokeWorker} label="Revoke worker" secondary><input type="hidden" name="worker" value={worker.id} /><label className="check-label"><input type="checkbox" name="confirmed" required />Revoke its credential and cancel pending jobs. This does not force-close a browser.</label></ActionForm>}</article>)}
      </Panel>
      <Panel title="Latest 100 monitoring jobs" hint="Refresh to see new progress; expired leases are not retried automatically">
        {jobs.length ? <div className="table-wrap"><table><thead><tr><th>Post</th><th>Created</th><th>State</th><th>Result</th><th>Action</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}>
          <td><Link href={`/dashboard/posts/${job.publication_id}`}>{publications.find((post) => post.id === job.publication_id)?.title || "Open post"}</Link></td><td>{formatTime(job.created_at, organization.time_zone)}</td>
          <td>{job.status}{job.status === "leased" && job.lease_expires_at && <small> · Lease deadline {formatTime(job.lease_expires_at, organization.time_zone)}</small>}</td><td><OutcomeBadge outcome={job.outcome} /></td>
          <td>{job.status === "pending" && <ActionForm action={cancelPendingCheck} label="Cancel pending" secondary><input type="hidden" name="job" value={job.id} /></ActionForm>}{job.status === "leased" && <ActionForm action={reconcileExpiredCheck} label="Reconcile expired lease" secondary><input type="hidden" name="job" value={job.id} /><label className="check-label"><input type="checkbox" name="reconciled" required />I stopped the old agent, closed this profile and reconciled partial results. Only expired leases can be released.</label></ActionForm>}</td>
        </tr>)}</tbody></table></div> : <EmptyState title="No monitoring jobs yet">Once monitoring is enabled, your connected local agent plans and claims due checks. The dashboard alone never launches local profiles.</EmptyState>}
      </Panel>
    </>}
  </>;
}
