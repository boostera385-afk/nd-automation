"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { confirmProfileImport, previewProfiles } from "@/app/actions/profiles";

export function ProfileImport() {
  const [state, action, pending] = useActionState(previewProfiles, {});
  return <div className="import-flow">
    <p className="muted small">Export the profile list from your own Incogniton setup as CSV with headers <code>profile_id,name,group</code>. Up to 5,000 rows / 1 MB. Import updates inventory claims only — it never launches, creates, or verifies profiles.</p>
    <form action={action} className="form-grid">
      <label>Inventory CSV<input name="file" type="file" accept=".csv,text/csv" required /></label>
      <button className="button secondary" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={15} aria-hidden /> Reading…</> : "Preview only"}</button>
    </form>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.errors && state.errors.length > 0 && <ul className="notice error" role="alert">{state.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
    {state.rows && state.rows.length > 0 && <>
      {state.success && <p className="notice success" role="status">{state.success}</p>}
      <h3>Preview · {state.rows.length} profiles</h3>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Group</th><th>Profile UUID</th></tr></thead><tbody>{state.rows.slice(0, 25).map((row) => <tr key={row.profile_id}><td>{row.name}</td><td>{row.group_name}</td><td><code>{row.profile_id}</code></td></tr>)}</tbody></table></div>
      {state.rows.length > 25 && <p className="muted small">Showing first 25 of {state.rows.length} rows; all valid rows are included on confirm.</p>}
      {(state.errors?.length ?? 0) === 0 && <ConfirmForm rows={state.rows} />}
    </>}
  </div>;
}

function ConfirmForm({ rows }: { rows: { profile_id: string; name: string; group_name: string }[] }) {
  const [state, action, pending] = useActionState(confirmProfileImport, {});
  return <form action={action} className="form-grid">
    <input type="hidden" name="records" value={JSON.stringify(rows)} />
    <label className="check"><input name="confirmed" type="checkbox" required />This export comes from my authorized Incogniton installation and contains no credentials.</label>
    <label className="check"><input name="archive_missing" type="checkbox" />Archive inventory profiles missing from this export (full-sync export only — never for partial exports).</label>
    <label className="check"><input name="archive_confirmed" type="checkbox" />If archiving missing profiles: this is a complete current export, not a partial one.</label>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p className="notice success" role="status">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Importing…" : "Confirm inventory import"}</button>
  </form>;
}
