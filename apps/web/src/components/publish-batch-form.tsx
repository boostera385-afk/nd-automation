"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { enqueueScheduledPublishBatch } from "@/app/actions/publishing";
import { WorkspaceField } from "./workspace-context";

export function PublishBatchForm({ drafts, timeZone }: {
  drafts: Array<{ id: string; revision: number; title: string }>; timeZone: string;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [chosen, setChosen] = useState<string[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [windowMinutes, setWindow] = useState(10);
  const [state, action, pending] = useActionState(enqueueScheduledPublishBatch, {});
  if (state.success) return <p role="status">{state.success}</p>;
  const entries = drafts.filter((draft) => chosen.includes(draft.id)).map((draft) => ({ draftId: draft.id, revision: draft.revision,
    localTime: times[draft.id] ?? "", windowMinutes }));
  return <form action={action} className="form-grid">
    <WorkspaceField />
    <p>Choose at most 20 already-approved revisions. Review each saved preview; selection does not approve or edit content. Each time is in <strong>{timeZone}</strong>, not your device timezone. Empty means immediate. Ambiguous/nonexistent DST times are refused.</p>
    <div className="table-wrap"><table><thead><tr><th>Authorize</th><th>Exact revision</th><th>Not before (business time)</th></tr></thead><tbody>
      {drafts.map((draft) => <tr key={draft.id}><td><input type="checkbox" aria-label={`Select revision ${draft.revision} of ${draft.title}`} checked={chosen.includes(draft.id)}
        disabled={pending || (!chosen.includes(draft.id) && chosen.length >= 20)} onChange={(event) => setChosen((current) => event.target.checked ? [...current, draft.id] : current.filter((id) => id !== draft.id))} /></td>
        <td><Link href={`/dashboard/content/${draft.id}`}>{draft.title}</Link> · revision {draft.revision}</td>
        <td><input type="datetime-local" aria-label={`Business-local dispatch time for ${draft.title}`} disabled={pending || !chosen.includes(draft.id)}
          value={times[draft.id] ?? ""} onChange={(event) => setTimes((current) => ({ ...current, [draft.id]: event.target.value }))} /></td></tr>)}
    </tbody></table></div>
    <label>Claim window (minutes)<input type="number" min={5} max={30} step={1} value={windowMinutes} disabled={pending} onChange={(event) => setWindow(Number(event.target.value))} /></label>
    <p className="small muted">A window is the allowed start time, not a promise of platform submission. Work stays tied to this session and its unchanged approved target. Paused/offline workers do not catch up after expiry. Large selections may not fit a short window; stagger their times deliberately.</p>
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="entries" value={JSON.stringify(entries)} />
    <label><input type="checkbox" name="confirmed" required disabled={pending} /> I reviewed every selected revision, customer, account, audience and time, have permission to publish each, and authorize only these exact revisions during my current work session.</label>
    {state.error && <p role="alert">{state.error}</p>}
    <button type="submit" disabled={pending || chosen.length === 0} aria-busy={pending}>{pending ? "Recording…" : `Authorize ${chosen.length} selected revision(s)`}</button>
  </form>;
}
