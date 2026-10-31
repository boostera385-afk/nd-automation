"use client";

import { useActionState, useState } from "react";
import { setBatchMonitoring } from "@/app/actions/workflow";
import { WorkspaceField } from "./workspace-context";

export type BatchProfile = { id: string; label: string; customer: string; worker: string; enabled: boolean; monitoring: boolean; posts: number };

export function MonitoringBatch({ profiles, activeSession }: { profiles: BatchProfile[]; activeSession: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [state, action, pending] = useActionState(setBatchMonitoring, {});
  const allowed = profiles.slice(0, 100);
  const chosen = selected.filter((id) => allowed.some((item) => item.id === id));
  const all = allowed.length > 0 && allowed.every((item) => chosen.includes(item.id));
  return <form action={action} className="form-grid">
    <WorkspaceField />
    <label className="check"><input type="checkbox" checked={all} onChange={() => setSelected(all ? [] : allowed.map((item) => item.id))} />Select all shown profiles ({allowed.length})</label>
    <div className="table-wrap"><table><thead><tr><th>Select</th><th>Profile / customer</th><th>Device</th><th>Tracked posts</th><th>This session</th></tr></thead><tbody>{allowed.map((item) => <tr key={item.id}><td><input type="checkbox" name="binding" value={item.id} aria-label={`Select ${item.label} for ${item.customer}`} checked={chosen.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></td><td>{item.label}<small>{item.customer}</small></td><td>{item.worker}<small>{item.enabled ? "Assigned worker" : "Worker disabled"}</small></td><td>{item.posts}</td><td>{item.monitoring ? "Checks enabled" : "Checks off"}</td></tr>)}</tbody></table></div>
    {profiles.length > 100 && <p className="notice">Only the first 100 profiles are shown for this batch. No other assignments will be changed.</p>}
    <label>Batch action<select name="mode" defaultValue={activeSession ? "enable" : "disable"}><option value="enable" disabled={!activeSession}>Enable due checks for this session</option><option value="disable">Disable checks / cancel pending reads</option></select></label>
    {!activeSession && <p className="notice">Start or resume work in the top bar to enable checks. Disabling remains available.</p>}
    <label className="check"><input name="confirmed" type="checkbox" required />I authorize this read-only batch for the selected profiles. This does not publish, import cookies or create accounts.</label>
    {state.error && <p className="notice error" role="alert">{state.error}</p>}{state.success && <p className="notice success" role="status">{state.success}</p>}
    <button className="button" type="submit" disabled={pending || chosen.length === 0}>{pending ? "Updating profiles…" : `Apply to ${chosen.length} profiles`}</button>
  </form>;
}
