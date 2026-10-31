"use client";

import { useActionState, useState } from "react";
import { cancelBrowserTask, enqueueBrowserTask } from "@/app/actions/automation-tasks";
import { automationKinds, describeResult, kindDescriptions, kindLabels, operatingSystems, statusLabels, statusTones, type AutomationKind, type AutomationTask, type InventoryProfile } from "@/lib/automation-tasks";
import { formatTime } from "@/lib/time";
import { WorkspaceField } from "./workspace-context";

type Worker = { id: string; name: string; enabled: boolean; last_seen_at: string | null };

function CancelForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelBrowserTask, {});
  return <form action={action}><WorkspaceField /><input type="hidden" name="task" value={id} /><button className="button secondary" type="submit" disabled={pending}>Cancel</button>{state.error && <small role="alert">{state.error}</small>}</form>;
}

export function BrowserTasks({ workers, tasks, profiles, timeZone, available }: { workers: Worker[]; tasks: AutomationTask[]; profiles: InventoryProfile[]; timeZone: string; available: boolean }) {
  const [kind, setKind] = useState<AutomationKind>("profile_create");
  const [state, action, pending] = useActionState(enqueueBrowserTask, {});
  const usable = workers.filter((worker) => worker.enabled);
  const writes = kind === "cookie_write" || kind === "proxy_write";
  if (!available) return <p className="notice">The browser task queue is not available on this deployment yet. The migration has not been applied, so no task can be queued.</p>;
  if (usable.length === 0) return <p>No automation agent is enabled yet. <a href="/dashboard/settings#connections">Register or re-enable the agent on this device</a> before queuing a browser task.</p>;
  if (writes && profiles.length === 0) return <p className="notice">No Incogniton profiles are recorded yet. Add your profiles under Profiles first; an import targets one recorded profile.</p>;
  const confirmText = writes
    ? `I authorize this import into the chosen Incogniton profile on this device's automation agent. It writes cookies or a proxy into that one profile; it does not post, publish, browse Nextdoor or change any other profile.`
    : `I authorize this task on this device's automation agent. It creates or reads only; it does not post, publish, create an account or change cookies.`;
  return <>
    <form action={action} className="form-grid">
      <WorkspaceField />
      <label>Device<select name="worker" defaultValue={usable[0].id} required>{usable.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
      <label>Task<select name="kind" value={kind} onChange={(event) => setKind(event.target.value as AutomationKind)}>{automationKinds.map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}</select></label>
      <p className="small muted">{kindDescriptions[kind]}</p>
      {kind === "profile_create" && <>
        <label>Profile name<input name="name" required minLength={2} maxLength={60} placeholder="e.g. Thomas Gutierrez 2" /></label>
        <label>Incogniton group (optional)<input name="group" maxLength={60} placeholder="Leave blank for no group" /></label>
        <label>Operating system<select name="os" defaultValue="windows">{operatingSystems.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </>}
      {(kind === "cookie_import" || kind === "proxy_import") && <label>Absolute file path on this device<input name="path" required maxLength={400} placeholder={kind === "cookie_import" ? "C:\\Exports\\cookies.txt" : "C:\\Exports\\proxies.txt"} /></label>}
      {writes && <>
        <label>Incogniton profile<select name="profile" required>{profiles.map((item) => <option key={item.profile_id} value={item.profile_id}>{item.name} · {item.profile_id.slice(0, 8)}…</option>)}</select></label>
        <label>Absolute file path on this device<input name="path" required maxLength={400} placeholder={kind === "cookie_write" ? "C:\\Exports\\cookies.txt" : "C:\\Exports\\proxies.txt"} /></label>
        {kind === "cookie_write" && <label className="check"><input name="replace" type="checkbox" />Clear the profile&apos;s existing cookies first (unchecked = add to them)</label>}
      </>}
      <label className="check"><input name="confirmed" type="checkbox" required />{confirmText}</label>
      {state.error && <p className="notice error" role="alert">{state.error}</p>}{state.success && <p className="notice success" role="status">{state.success}</p>}
      <button className="button" type="submit" disabled={pending}>{pending ? "Queuing…" : `Queue ${kindLabels[kind].toLowerCase()}`}</button>
    </form>
    <div className="table-wrap"><table><thead><tr><th>Task</th><th>Device</th><th>State</th><th>Outcome</th><th>Created</th><th></th></tr></thead><tbody>
      {tasks.length === 0 && <tr><td colSpan={6}>No browser task has been queued yet.</td></tr>}
      {tasks.map((task) => {
        const worker = workers.find((item) => item.id === task.worker_id);
        return <tr key={task.id}>
          <td>{kindLabels[task.kind]}<small>{task.summary}</small></td>
          <td>{worker?.name ?? "Unassigned device"}</td>
          <td><span className={statusTones[task.status] === "neutral" ? "badge" : `badge tone-${statusTones[task.status]}`}>{statusLabels[task.status]}</span></td>
          <td>{describeResult(task, worker?.name, (profileId) => profiles.find((item) => item.profile_id === profileId)?.name)}{task.status === "succeeded" && task.completed_at && <small>Finished {formatTime(task.completed_at, timeZone)}</small>}</td>
          <td>{formatTime(task.created_at, timeZone)}</td>
          <td>{task.status === "pending" ? <CancelForm id={task.id} /> : null}</td>
        </tr>;
      })}
    </tbody></table></div>
    <p className="muted small">This queue runs on the automation agent on this device — the same PC where Incogniton, Fudge and your Sheet tools live — not in this browser tab. The agent polls once, runs one task, and reports back. File checks never upload a file; imports send the parsed entries only to Incogniton&apos;s local API on the same device, and the dashboard stores counts plus, for a proxy set, host:port — never a cookie value or a proxy username/password. Proxy login details never leave this device.</p>
  </>;
}
