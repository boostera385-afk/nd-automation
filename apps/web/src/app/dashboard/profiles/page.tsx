import Link from "next/link";
import { requireWorkspace, getDashboardData } from "@/lib/data";
import { getOperationsData } from "@/lib/operations-data";
import { isMissingSchemaError } from "@/lib/checks";
import { heartbeatState } from "@/lib/workflow";
import { formatTime } from "@/lib/time";
import type { InventoryProfile } from "@/lib/profiles";
import { ActionForm } from "@/components/action-form";
import { ProfileImport } from "@/components/profile-import";
import { ScanImport, type LatestScanSummary } from "@/components/scan-import";
import { ProfileAssignment } from "@/components/profile-assignment";
import { setProfileArchived } from "@/app/actions/profiles";
import { PageHeader, Panel } from "@/components/ui";

export default async function Profiles() {
  const { db, organization } = await requireWorkspace(true);
  const [result, operations, data] = await Promise.all([
    db.from("reporting_profile_inventory").select("profile_id,name,group_name,status,updated_at").eq("organization_id", organization.id).order("name").order("profile_id").limit(501),
    getOperationsData(), getDashboardData(),
  ]);
  if (result.error && !isMissingSchemaError(result.error)) throw new Error("Profile inventory could not be loaded.");
  const profiles = (result.data ?? []).slice(0, 500) as InventoryProfile[];
  const enabledWorkers = operations.workers.filter((worker) => worker.enabled);
  const assignedIds = new Set(operations.bindings.map((binding) => binding.profile_id));
  const choices = profiles.filter((profile) => profile.status === "active" && !assignedIds.has(profile.profile_id));
  // The operations list carries the newest 20 tasks; the newest completed scan is the import source.
  const scanTask = operations.tasks.find((task) => task.kind === "inventory_scan" && task.status === "succeeded");
  const scannedList = scanTask?.result && Array.isArray(scanTask.result.profiles) ? (scanTask.result.profiles as unknown[]) : null;
  const latestScan: LatestScanSummary = scanTask && scannedList
    ? {
        total: typeof scanTask.result?.total === "number" ? scanTask.result.total : scannedList.length,
        stored: scannedList.length,
        truncated: scanTask.result?.truncated === true,
        completedText: scanTask.completed_at ? formatTime(scanTask.completed_at, organization.time_zone) : "an unknown time",
      }
    : null;
  return <>
    <PageHeader title="Profiles" description="Select existing profiles and map each to its customer once. Master Sheet sync and monitoring reuse these saved mappings." actions={<Link className="button secondary" href="/dashboard/run">Run checks</Link>} />
    <Panel title="Saved customer mappings" hint={`${operations.bindings.length} loaded assignments`}>
      {operations.bindings.length ? <div className="table-wrap"><table><thead><tr><th>Sheet profile name</th><th>Customer</th><th>Group</th><th>Device</th><th>Identity</th></tr></thead><tbody>{operations.bindings.map((binding) => {
        const profile = profiles.find((item) => item.profile_id === binding.profile_id);
        const worker = operations.workers.find((item) => item.id === binding.worker_id);
        return <tr key={binding.id}><td>{binding.account_label}</td><td>{data.customers.find((customer) => customer.id === binding.customer_id)?.name ?? "Assigned customer"}</td><td>{profile?.group_name ?? "Not loaded"}</td><td>{worker?.name ?? "Assigned device"}<small>{worker ? heartbeatState(worker, operations.loadedAt) : "Unknown"}</small></td><td><details><summary>Exact profile</summary><code>{binding.profile_id}</code><p className="small">{profile?.name ?? "No loaded inventory claim"}. Inventory is not live readiness.</p></details></td></tr>;
      })}</tbody></table></div> : <p>No mappings yet. Choose an existing profile below; you will not need to reselect its customer for every Sheet import.</p>}
      {(operations.limited || data.truncated || (result.data?.length ?? 0) > 500) && <p className="notice">Loaded inventory/mappings/customers are partial. Missing choices must not be replaced with a different profile.</p>}
    </Panel>
    <Panel title="Map an existing profile" hint="One-time authorization">
      {!result.error && choices.length && enabledWorkers.length && data.customers.length ? <ProfileAssignment profiles={choices} workers={enabledWorkers} customers={data.customers} /> : <p>{choices.length === 0 ? "No unassigned active inventory profiles are loaded. " : ""}{!data.customers.length ? "Add your customer in Settings / More. " : ""}{!enabledWorkers.length ? "Register this device's automation agent in connection setup. " : ""}<Link href="/dashboard/settings#connections">Open setup</Link>. Inventory import is available below.</p>}
    </Panel>
    <details className="workflow-details"><summary>Inventory setup & advanced tools</summary>
      <p className="muted small">Profiles are detected from Incogniton on this device: the automation agent reads the UUID/name/group list (no cookies, proxies or account details), and the result imports here in one click. A CSV export remains available as a fallback. Neither path launches, creates or verifies profiles. Archive affects inventory suggestions only, not saved assignments.</p>
      {!result.error ? <><ScanImport latest={latestScan} /><ProfileImport /><div className="table-wrap"><table><thead><tr><th>Inventory profile</th><th>Group</th><th>Status</th><th>Advanced</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.profile_id}><td>{profile.name}<small>{profile.profile_id}</small></td><td>{profile.group_name}</td><td>{profile.status}</td><td><ActionForm action={setProfileArchived} label={profile.status === "active" ? "Archive inventory" : "Reactivate inventory"} secondary><input type="hidden" name="profile" value={profile.profile_id} /><input type="hidden" name="archived" value={profile.status === "active" ? "true" : "false"} /><label className="check"><input type="checkbox" name="confirmed" required />Change this inventory claim only.</label></ActionForm></td></tr>)}</tbody></table></div></> : <p>Inventory setup is unavailable. Ask your administrator to complete the database setup.</p>}
      <p><Link href="/dashboard/automation">Worker replacement, manual UUID assignment & diagnostics</Link></p>
    </details>
  </>;
}
