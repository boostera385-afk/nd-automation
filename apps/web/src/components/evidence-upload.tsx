"use client";
import { useActionState } from "react";
import { uploadEvidence } from "@/app/actions/evidence";
import { WorkspaceField } from "./workspace-context";

export function EvidenceUpload({ publication }: { publication: string }) {
  const [state, action, pending] = useActionState(uploadEvidence, {});
  return <form action={action} className="form-grid"><WorkspaceField /><input type="hidden" name="publication" value={publication} />
    <label>PNG/JPEG evidence (up to 3 MiB)<input type="file" name="file" accept="image/png,image/jpeg" required /></label>
    <label>Observed at (UTC/offset required)<input name="observed" required placeholder="2026-11-03T15:30:00Z" /></label>
    <label>Review retention after days (optional, no automatic deletion)<input name="reviewDays" type="number" min={1} max={3650} /></label>
    <label className="check"><input type="checkbox" name="reviewed" required />I am authorized to store this evidence and reviewed personal data and embedded image metadata. This upload is not a visibility check.</label>
    <button className="button" disabled={pending}>{pending ? "Uploading…" : "Save private evidence"}</button>
    {state.error && <p role="alert">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}
  </form>;
}
