"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CheckCheck, LoaderCircle } from "lucide-react";
import { recordChecks, type CheckState } from "@/app/actions/checks";
import { CHECK_OUTCOMES, checkOutcomes, type CheckOutcome } from "@/lib/checks";
import type { Visibility } from "@/lib/validation";
import { Badge, OutcomeBadge } from "./ui";

export type QueueRow = { id: string; title: string; customer: string; account: string; visibility: Visibility; outcome: string | null; lastChecked: string; reason: string };

const primary = CHECK_OUTCOMES.filter((outcome) => checkOutcomes[outcome].primary);
const secondary = CHECK_OUTCOMES.filter((outcome) => !checkOutcomes[outcome].primary);

function OutcomeCard({ outcome }: { outcome: CheckOutcome }) {
  const info = checkOutcomes[outcome];
  return <label className={`outcome-card tone-${info.tone}`}><input type="radio" name="outcome" value={outcome} required /><span><strong>{info.label}</strong><small>{info.hint}</small></span></label>;
}

export function CheckQueue({ rows }: { rows: QueueRow[] }) {
  const [state, action, pending] = useActionState<CheckState, FormData>(recordChecks, {});
  const [selected, setSelected] = useState<string[]>([]);
  const available = new Set(rows.map((row) => row.id));
  const chosen = selected.filter((id) => available.has(id));
  const all = rows.length > 0 && chosen.length === rows.length;
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  return <form action={action} className="check-queue">
    <div className="queue-toolbar">
      <label className="check"><input type="checkbox" checked={all} onChange={() => setSelected(all ? [] : rows.map((row) => row.id))} aria-label="Select all posts that need a check" />Select all ({rows.length})</label>
      <span className="muted small">{chosen.length} selected</span>
    </div>
    <div className="table-wrap"><table className="data-table"><thead><tr><th><span className="sr-only">Select</span></th><th>Post / customer</th><th>Account</th><th>Why it is here</th><th>Last result</th><th>Last attempt</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id} className={chosen.includes(row.id) ? "is-selected" : undefined}>
        <td className="select-cell"><input type="checkbox" name="publication_ids" value={row.id} checked={chosen.includes(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.title}`} /></td>
        <td data-label="Post"><Link className="post-title" href={`/dashboard/posts/${row.id}`}>{row.title}</Link><small>{row.customer}</small></td>
        <td data-label="Account">{row.account}</td>
        <td data-label="Why">{row.reason}</td>
        <td data-label="Last result"><Badge status={row.visibility} />{row.outcome && <OutcomeBadge outcome={row.outcome} />}</td>
        <td data-label="Last attempt">{row.lastChecked}</td>
      </tr>)}
    </tbody></table></div>

    {chosen.length > 0 && <fieldset className="queue-actions" key={state.nonce ?? "fresh"}>
      <legend>Record what you found for {chosen.length} {chosen.length === 1 ? "post" : "posts"}</legend>
      <div className="outcome-grid">{primary.map((outcome) => <OutcomeCard key={outcome} outcome={outcome} />)}</div>
      <details className="outcome-more"><summary>Other results</summary><div className="outcome-grid">{secondary.map((outcome) => <OutcomeCard key={outcome} outcome={outcome} />)}</div></details>
      <label>Evidence or notes<textarea name="notes" rows={2} maxLength={2000} placeholder="Required for “Removed from Nextdoor”: what message did Nextdoor show? Never paste passwords." /></label>
      {chosen.length === 1 && <label>Comments seen on the post (optional)<input name="comments_total" type="number" min={0} max={10000000} inputMode="numeric" placeholder="Leave blank if unknown" /></label>}
      <label className="check"><input name="reviewed" type="checkbox" required />I opened {chosen.length === 1 ? "this post" : "each selected post"} in an authorized view. A timeout or login problem is not proof of removal.</label>
      <button className="button" type="submit" disabled={pending} aria-busy={pending}>{pending ? <><LoaderCircle className="spin" size={15} aria-hidden /> Saving…</> : <><CheckCheck size={16} aria-hidden /> Record {chosen.length} {chosen.length === 1 ? "check" : "checks"}</>}</button>
    </fieldset>}
    {state.error && <p className="notice error" role="alert">{state.error}</p>}
    {state.success && <p className="notice success" role="status">{state.success}</p>}
  </form>;
}
