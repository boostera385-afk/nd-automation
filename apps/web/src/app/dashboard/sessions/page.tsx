import { getDashboardData, requireWorkspace } from "@/lib/data";
import { formatTime, sessionSeconds } from "@/lib/time";
import type { WorkSession } from "@/lib/types";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { PublicationTable } from "@/components/publication-table";

export default async function Sessions() {
  const { db, user, organization, isStaff } = await requireWorkspace();
  const { session, publications, customers } = await getDashboardData();
  const history = isStaff ? await db.from("reporting_work_sessions").select("*").eq("organization_id", organization.id).eq("user_id", user.id).order("started_at", { ascending: false }).limit(30) : { data: [], error: null };
  if (history.error) throw new Error("Session history could not be loaded.");
  return <>
    <PageHeader title="Your work sessions" description="Track an 8–10 hour day. Connected workers can claim read-only checks only during an authorized active session. Enable each profile separately in Automation control; this does not enable posting or account creation." />
    <div className="notice subtle"><strong>Work session ≠ Pacific calendar day</strong><p>A shift may cross Pacific midnight. Today/Yesterday group publication dates; the table below groups records added during the current reporting session, not when they were actually posted. Pause/End work stops new worker claims; an in-flight read may finish.</p></div>
    <Panel title="Records added in the current session">{session ? <PublicationTable publications={publications.filter((post) => post.recorded_session_id === session.id)} customers={customers} zone={organization.time_zone} /> : <EmptyState title="Session closed">Start work in the clock bar to record a new session. Closing a session is normal. No automatic checking runs while the computer is off.</EmptyState>}</Panel>
    <Panel title="Your latest 30 sessions">{history.data?.length ? <div className="table-wrap"><table><thead><tr><th>Started</th><th>Ended</th><th>State</th><th>Active duration</th><th>Device timezone</th></tr></thead><tbody>{(history.data as WorkSession[]).map((item) => <tr key={item.id}><td>{formatTime(item.started_at, organization.time_zone)}</td><td>{item.ended_at ? formatTime(item.ended_at, organization.time_zone) : "Still open"}</td><td>{item.status}</td><td>{Math.floor(sessionSeconds(item) / 3600)}h {Math.floor(sessionSeconds(item) % 3600 / 60)}m</td><td>{item.device_time_zone}</td></tr>)}</tbody></table></div> : <EmptyState title="No work sessions">Sessions appear after you start work. Customers cannot control or inspect staff sessions.</EmptyState>}</Panel>
  </>;
}
