"use client";

import { useActionState, useState } from "react";
import { registerWorker } from "@/app/actions/workers";
import { WorkspaceField } from "./workspace-context";

export function WorkerRegistration() {
  const [state, action, pending] = useActionState(registerWorker, {});
  const [copyMessage, setCopyMessage] = useState("");
  return <form action={action} className="form-grid">
    <WorkspaceField />
    <label>Helper name<input name="name" required minLength={2} maxLength={100} defaultValue="My computer" autoComplete="off" /></label>
    <label className="check-label"><input type="checkbox" name="authorized" required />Connect a helper I control to this business account. This does not restrict where I can sign in or start browser jobs.</label>
    {state.error && <p className="notice error" role="alert">{state.error}</p>}
    {state.success && <p className="notice success" role="status">{state.success}</p>}
    {state.connection && <div className="notice"><strong>Save your private helper connection</strong><p>Download once and keep it on the computer running the helper. It is a credential, not a public settings file. Never share it or add it to the repository.</p>
      <button className="button secondary" type="button" onClick={() => { const url = URL.createObjectURL(new Blob([state.connection!], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "nd-worker.private.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setCopyMessage("Downloaded private connection. Move it to the helper's .monitoring/worker.json; delete the extra Downloads copy after verifying setup."); }}>Download private connection</button>
      <details><summary>Advanced: copy connection settings</summary><p>Save as <code>.monitoring/worker.json</code>. Anyone with this credential can claim assigned jobs. Credentials cannot be retrieved again.</p>
      <textarea aria-label="Private worker connection configuration" readOnly rows={9} value={state.connection} spellCheck={false} autoComplete="off" />
      <button className="button secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(state.connection!); setCopyMessage("Copied. Store privately and clear the clipboard after saving."); } catch { setCopyMessage("Copy was unavailable. Select and copy the configuration manually."); } }}>Copy private configuration</button>
      </details><p role="status">{copyMessage}</p></div>}
    <button className="button" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Connecting…" : "Connect local helper"}</button>
  </form>;
}
