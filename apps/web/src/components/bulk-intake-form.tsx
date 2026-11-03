"use client";
import { useActionState, useState } from "react";
import { enqueueIntakeBatch } from "@/app/actions/bulk-intake";
import { stagedIntakeSchema } from "@/lib/bulk-intake";
import { WorkspaceField } from "./workspace-context";
import { LocalHelperField } from "./local-helper-field";

export function BulkIntakeForm({ workers, request }: { workers: Array<{ id: string; name: string; enabled: boolean }>; request: string }) {
  const [state, action, pending] = useActionState(enqueueIntakeBatch, {});
  const [text, setText] = useState("");
  const [requestId] = useState(request); // Preserve identity across retries/refreshes.
  let preview = null;
  try { preview = stagedIntakeSchema.safeParse(JSON.parse(text)); } catch { /* no raw parser errors/credentials */ }
  return <form action={action} className="form-grid"><WorkspaceField /><input type="hidden" name="request" value={requestId} />
    <p>Prefer normal login. For permitted account migration/recovery or an authorized network proxy only, prepare the private files locally with <code>bulk_intake.py</code>. Paste only its redacted staged output here. Secrets remain in current-user Windows DPAPI ciphertext, outside releases.</p>
    <LocalHelperField helpers={workers.filter((worker) => worker.enabled)} />
    <label>Redacted staged descriptors (no cookie/proxy values)<textarea name="descriptors" value={text} onChange={(event) => setText(event.target.value)} maxLength={100000} required /></label>
    {preview?.success && <ul>{preview.data.rows.map((row) => <li key={`${row.profile_id}/${row.kind}`}>{row.profile_id} · {row.kind} · {row.entries} entries{row.replace && " · clears existing cookies first"}</li>)}</ul>}
    <label className="check"><input name="permitted" type="checkbox" required />Normal login is insufficient for this permitted use. I control these accounts and am authorized to transfer their sessions/use these proxies; not to evade detection or restrictions.</label>
    <label className="check"><input name="confirmed" type="checkbox" required />I reviewed every exact profile, helper and clear-first choice and authorize these writes in my current work session.</label>
    <button className="button secondary" disabled={pending || !!state.success || !preview?.success}>{pending ? "Recording…" : "Authorize exact intake batch"}</button>
    {state.error && <p role="alert">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}
  </form>;
}
