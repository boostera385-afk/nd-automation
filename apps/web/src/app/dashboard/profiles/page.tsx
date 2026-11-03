import Link from "next/link";
import { requireWorkspace, getDashboardData } from "@/lib/data";
import { getOperationsData } from "@/lib/operations-data";
import { isMissingSchemaError } from "@/lib/checks";
import { heartbeatState } from "@/lib/workflow";
import { formatTime } from "@/lib/time";
import { PROFILE_SCAN_LIMIT, profileRowSchema, type InventoryProfile } from "@/lib/profiles";
import { ProfileImport } from "@/components/profile-import";
import { ScanImport, type LatestScanSummary } from "@/components/scan-import";
import { ProfileAssignment } from "@/components/profile-assignment";
import { PageHeader, Panel } from "@/components/ui";
import { ComputerControls } from "@/components/computer-controls";
import { hasActiveSession } from "@/lib/active-session";
import { LiveRefresh } from "@/components/live-refresh";
import { canManageSetup } from "@/lib/setup-access";
import { loadProfileInventory } from "@/lib/profile-inventory-data";
import { ProfileInventoryTable } from "@/components/profile-inventory-table";

export default async function Profiles() {
  const { db, organization, membership } = await requireWorkspace(true);
  const manageSetup = canManageSetup(membership.role);
  const [result, operations, data] = await Promise.all([
    loadProfileInventory(db, organization.id),
    getOperationsData(), getDashboardData(),
  ]);
  if (result.error && !isMissingSchemaError(result.error)) throw new Error("Profile inventory could not be loaded.");
  const profiles = result.data as InventoryProfile[];
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
  const detected = scannedList?.flatMap((row) => { const parsed = profileRowSchema.safeParse(row); return parsed.success ? [parsed.data] : []; }) ?? [];
  return <>
    <PageHeader title="Profiles" description={manageSetup ? "Detect existing profiles and save their customer once. No repeated profile-ID typing." : "Shared saved profiles and customer mappings, prepared by your administrator. No daily import or mapping is needed."} actions={<LiveRefresh />} />
    <Panel title={manageSetup ? "Find your Incogniton profiles" : "Start your prepared laptop"}><ComputerControls workers={operations.workers} activeSession={hasActiveSession(data.session, operations.loadedAt)} available={operations.automationAvailable} manageSetup={manageSetup} />
      {manageSetup && <ScanImport latest={latestScan} />}
      {manageSetup && detected.length > 0 && <><p className="small">Latest completed scan — not a live readiness check. Save it with the button above before assigning customers.{detected.length !== scannedList?.length && " Some returned rows are invalid; import validation must pass before saving."}</p><ProfileInventoryTable profiles={detected} /></>}
    </Panel>
    <Panel title="Saved customer mappings" hint={`${operations.bindings.length} loaded assignments`}>
      {operations.bindings.length ? <div className="table-wrap"><table><thead><tr><th>Sheet profile name</th><th>Customer</th><th>Group</th><th>Device</th><th>Identity</th></tr></thead><tbody>{operations.bindings.map((binding) => {
        const profile = profiles.find((item) => item.profile_id === binding.profile_id);
        const worker = operations.workers.find((item) => item.id === binding.worker_id);
        return <tr key={binding.id}><td>{binding.account_label}</td><td>{data.customers.find((customer) => customer.id === binding.customer_id)?.name ?? "Assigned customer"}</td><td>{profile?.group_name ?? "Not loaded"}</td><td>{worker?.name ?? "Assigned device"}<small>{worker ? heartbeatState(worker, operations.loadedAt) : "Unknown"}</small></td><td><details><summary>Exact profile</summary><code>{binding.profile_id}</code><p className="small">{profile?.name ?? "No loaded inventory claim"}. Inventory is not live readiness.</p></details></td></tr>;
      })}</tbody></table></div> : <p>No mappings yet. Choose an existing profile below; you will not need to reselect its customer for every Sheet import.</p>}
      {(operations.limited || data.truncated || result.limited) && <p className="notice">Loaded inventory/mappings/customers are partial. Missing choices must not be replaced with a different profile.</p>}
    </Panel>
    {manageSetup && <Panel title="Map an existing profile" hint="One-time authorization">
      {!result.error && choices.length && enabledWorkers.length && data.customers.length ? <ProfileAssignment profiles={choices} workers={enabledWorkers} customers={data.customers} /> : <p>{choices.length === 0 ? "No unassigned active inventory profiles are loaded. " : ""}{!data.customers.length ? "Add your customer in Settings / More. " : ""}{!enabledWorkers.length ? "Register this device's automation agent in connection setup. " : ""}<Link href="/dashboard/settings#connections">Open setup</Link>. Inventory import is available below.</p>}
    </Panel>}
    {!manageSetup && <Panel title="Shared profile inventory"><p>These are saved workspace records, not proof that Incogniton on this laptop has these profiles. Ask your administrator about missing access or mappings.</p><ProfileInventoryTable profiles={profiles} /></Panel>}
    {manageSetup && <>
    <details className="workflow-details"><summary>Inventory setup & advanced tools</summary>
      <p className="muted small">Profiles are detected from Incogniton on the connected helper: it reads UUID/name/group only, capped at {PROFILE_SCAN_LIMIT} entries and a result-size budget. A CSV export remains the fallback for omitted profiles. Neither path launches, creates or verifies profiles. Archive affects inventory suggestions only, not saved assignments.</p>
      {!result.error ? <><ProfileImport /><ProfileInventoryTable profiles={profiles} editable /></> : <p>Inventory setup is unavailable. Ask your administrator to complete the database setup.</p>}
      <p><Link href="/dashboard/automation">Worker replacement, manual UUID assignment & diagnostics</Link></p>
    </details>
    </>}
  </>;
}
