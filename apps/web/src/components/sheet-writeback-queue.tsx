"use client";

import { useActionState, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { cancelPendingSheetWriteback, enqueueSheetWriteback } from "@/app/actions/sheet-writeback";
import { ActionForm } from "./action-form";
import { WorkspaceField } from "./workspace-context";

export type WritebackIntent = { action: "append" | "update_cells"; tab: string; rowRef: string | null; values: Array<Record<string, string | null>> };
export type WritebackItem = {
  id: string; seq: number; status: "pending" | "leased" | "delivered" | "conflict" | "failed" | "cancelled"; attempts: number; intent: WritebackIntent;
  lease_expires_at: string | null; last_error: string | null; created_at: string; delivered_at: string | null;
};

const statusClass: Record<WritebackItem["status"], string> = { pending: "unknown", leased: "unknown", delivered: "live", conflict: "unavailable", failed: "unavailable", cancelled: "" };

function EnqueueForm() {
  const [requestId] = useState(() => crypto.randomUUID());
  const [stableKey] = useState(() => `web-${crypto.randomUUID()}`);
  const [state, action, pending] = useActionState(enqueueSheetWriteback, {});
  if (state.success) return <p role="status">{state.success}</p>;
  return <form action={action} className="form-grid">
    <WorkspaceField />
    <h3>Queue one explicit write intent</h3>
    <label>Intent action
      <select name="action" defaultValue="append" disabled={pending}>
        <option value="append">append a row</option>
        <option value="update_cells">update cells at one existing row</option>
      </select>
    </label>
    <label>Sheet tab name<input name="tab" maxLength={80} required disabled={pending} placeholder="Exact tab name, for example Auto Posting" /></label>
    <label>Row reference (update_cells only)<input name="rowRef" maxLength={300} disabled={pending} placeholder="for example A2 — leave empty for append" /></label>
    <label>Row values (JSON array of column/value objects)
      <textarea name="rows" rows={5} required disabled={pending} placeholder={'[{"Profile Name": "Fixture profile", "Status": "Filled"}]'} />
    </label>
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="stableKey" value={stableKey} />
    <label><input type="checkbox" name="confirmed" required disabled={pending} /> I reviewed this exact intent and authorize queueing it in the shared backend. Delivery is inactive; no Sheet cell is touched.</label>
    {state.error && <p role="alert">{state.error}</p>}
    <button type="submit" disabled={pending} aria-busy={pending}>{pending ? <><LoaderCircle className="spin" size={15} aria-hidden /> Queueing…</> : "Queue write intent"}</button>
  </form>;
}

function CancelPendingForm({ itemId }: { itemId: string }) {
  const [requestId] = useState(() => crypto.randomUUID());
  return <ActionForm action={cancelPendingSheetWriteback} label="Cancel pending" secondary>
    <input type="hidden" name="itemId" value={itemId} />
    <input type="hidden" name="requestId" value={requestId} />
    <label className="small"><input type="checkbox" name="confirmed" required /> confirm cancel</label>
  </ActionForm>;
}

/** Read-mostly view: statuses are shown exactly as recorded; nothing here dispatches a Sheet write. */
export function SheetWritebackQueue({ items, total }: { items: WritebackItem[]; total: number }) {
  const counts = items.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {});
  const summary = Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(" · ") || "no intents shown";
  return <>
    <EnqueueForm />
    <h3>Queue status — newest {items.length} of {total}</h3>
    <p className="small muted">{summary} among the items shown. Bounded view; not the complete history.</p>
    {items.length === 0 ? <p>No writeback intents are recorded for this business yet. Nothing is dispatched anywhere automatically.</p> : <div className="table-wrap"><table>
      <thead><tr><th>#</th><th>Intent</th><th>Status</th><th>Attempts</th><th>Lease expires (UTC)</th><th>Last error</th><th>Created (UTC)</th><th>Action</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}>
        <td>{item.seq}</td>
        <td className="status-text">{item.intent.action === "append" ? `Append ${item.intent.values.length === 1 ? "row" : `${item.intent.values.length} rows`} to ${item.intent.tab}` : `Update ${item.intent.rowRef} in ${item.intent.tab}`}</td>
        <td><span className={`badge ${statusClass[item.status]}`}><span className="badge-dot" aria-hidden />{item.status}</span></td>
        <td>{item.attempts}</td>
        <td className="status-text">{item.lease_expires_at ? new Date(item.lease_expires_at).toISOString().replace("Z", "Z") : "—"}</td>
        <td className="status-text">{item.last_error ?? "—"}</td>
        <td>{new Date(item.created_at).toISOString()}</td>
        <td>{item.status === "pending" ? <CancelPendingForm itemId={item.id} /> : <span className="muted">{item.delivered_at ? `delivered ${new Date(item.delivered_at).toISOString()}` : "—"}</span>}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="small muted">Delivered, conflict and failed outcomes are terminal and never rewritten. An expired lease is reclaimed automatically at the next claim; leased rows here do not imply any Sheet activity.</p>
  </>;
}
