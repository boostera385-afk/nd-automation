"use client";

import { useActionState, useState } from "react";
import { registerWorker } from "@/app/actions/workers";
import { WorkspaceField } from "./workspace-context";

export function WorkerRegistration() {
  const [state, action, pending] = useActionState(registerWorker, {});
  const [copyMessage, setCopyMessage] = useState("");
  return <form action={action} className="form-grid">
    <WorkspaceField />
    <label>Device name<input name="name" required minLength={2} maxLength={100} placeholder="e.g. This PC" autoComplete="off" /></label>
    <label className="check-label"><input type="checkbox" name="authorized" required />I control this device and authorize its automation agent. This does not enable browser jobs.</label>
    {state.error && <p className="notice error" role="alert">{state.error}</p>}
    {state.success && <p className="notice success" role="status">{state.success}</p>}
    {state.connection && <div className="notice"><strong>Private agent configuration — shown only in this response</strong><p>Save as <code>.monitoring/worker.json</code> on this device. Anyone with this credential can claim and submit assigned monitoring jobs. Never send it to chat or commit it.</p>
      <textarea aria-label="Private worker connection configuration" readOnly rows={9} value={state.connection} spellCheck={false} autoComplete="off" />
      <button className="button secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(state.connection!); setCopyMessage("Copied. Store privately and clear the clipboard after saving."); } catch { setCopyMessage("Copy was unavailable. Select and copy the configuration manually."); } }}>Copy private configuration</button>
      <p role="status">{copyMessage}</p></div>}
    <button className="button" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Registering…" : "Register this device's agent"}</button>
  </form>;
}
