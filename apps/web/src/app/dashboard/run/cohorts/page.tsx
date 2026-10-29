import Link from "next/link";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { loadCohortHistory } from "@/lib/cohort-data";
import { businessDate, formatTime, shiftDay } from "@/lib/time";
import { CohortRefresh } from "@/components/cohort-refresh";
import { PageHeader, Panel } from "@/components/ui";

export default async function CheckCohorts() {
  const { organization } = await requireWorkspace(true);
  const [data, history] = await Promise.all([getDashboardData(), loadCohortHistory()]);
  const now = new Date();
  const activeSession = data.session?.status === "active" && now.getTime() - Date.parse(data.session.started_at) < 10 * 3600_000;
  return <>
    <PageHeader eyebrow="EXACT DATE COHORT" title="Refresh post statuses" description="Choose a prior publication date once. Preserve every tracked member and follow its exact job or skip reason." actions={<Link className="button secondary" href="/dashboard/run">Run controls</Link>} />
    <div className="notice">Read-only monitoring only. A queued job is not a completed observation. Worker availability, active session and explicit profile authorization remain required. Sheet delivery is not connected.</div>
    <Panel title="Queue a reviewed cohort">
      {!history.available ? <p className="notice">{history.setup ? "Cohort protocol setup is pending. The local reviewed SQL draft has not been deployed here; no refresh controls are enabled." : "Cohort history could not be verified. Refresh controls are disabled rather than treating failed reads as empty."}</p>
        : data.truncated ? <p className="notice">Customer/reporting records are incomplete. Resolve loaded-data limits before choosing a cohort.</p>
          : !data.customers.length ? <p>Add an authorized customer and exact tracked publication records first.</p>
            : <CohortRefresh customers={data.customers} initialDay={shiftDay(businessDate(now, organization.time_zone), -1)} activeSession={Boolean(activeSession)} />}
    </Panel>
    <Panel title="Saved requests" hint="Latest 20 immutable receipts; not an all-time list">
      {history.available ? history.rows.length ? <ul>{history.rows.map((row) => <li key={row.id}><Link href={`/dashboard/run/cohorts/${row.id}`}>{row.receipt.day} · {row.receipt.kind} · {row.receipt.total} tracked records</Link> · {formatTime(row.created_at, organization.time_zone)}</li>)}</ul> : <p>No cohort requests are saved. Opening this page never queues checks.</p> : <p>Saved requests are unavailable, not zero.</p>}
    </Panel>
  </>;
}
