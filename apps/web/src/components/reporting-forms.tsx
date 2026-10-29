"use client";

import { useActionState } from "react";
import { recordChecks } from "@/app/actions/checks";
import { addComment, addPublication, confirmImport, createCustomer, previewImport, recordObservation, type ImportState } from "@/app/actions/reporting";
import { CHECK_OUTCOMES, checkOutcomes } from "@/lib/checks";
import type { Customer } from "@/lib/types";
import { ActionForm } from "./action-form";
import { WorkspaceField } from "./workspace-context";

function CustomerSelect({ customers }: { customers: Customer[] }) {
  return <label>Customer<select name="customer_id" required defaultValue=""><option value="" disabled>Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.time_zone}</option>)}</select></label>;
}

export function CustomerForm() {
  return <ActionForm action={createCustomer} label="Save customer"><label>Customer name<input name="name" minLength={2} maxLength={120} required placeholder="Customer or business name" /></label><label>Service / campaign<input name="service" maxLength={160} placeholder="Optional service description" /></label><label>Customer timezone<input name="time_zone" defaultValue="America/Los_Angeles" required /><span className="field-hint">An IANA zone; e.g. America/Los_Angeles or America/Phoenix.</span></label></ActionForm>;
}

export function PublicationForm({ customers }: { customers: Customer[] }) {
  return <ActionForm action={addPublication} label="Record post link"><CustomerSelect customers={customers} /><label>Post title / reference<input name="title" minLength={3} maxLength={200} required /></label><label>Exact post URL<input name="url" type="url" required placeholder="https://nextdoor.com/p/…" /></label><label>Authorized account label<input name="account_label" maxLength={120} required placeholder="Customer-owned account / business presence" /></label><label>Actual publication time (optional)<input name="published_local" type="datetime-local" /><span className="field-hint">Interpreted in the selected customer’s timezone. Leave blank if unknown; not a future publishing schedule.</span></label><label className="check"><input name="authorized" type="checkbox" required />I am authorized to record this customer’s post and data.</label></ActionForm>;
}

export function SingleCheckForm({ publicationId }: { publicationId: string }) {
  const options = (tone: "positive" | "negative" | "attention") => CHECK_OUTCOMES.filter((outcome) => checkOutcomes[outcome].tone === tone).map((outcome) => <option key={outcome} value={outcome}>{checkOutcomes[outcome].label}</option>);
  return <ActionForm action={recordChecks} label="Record check"><input type="hidden" name="publication_ids" value={publicationId} /><label>What did you find?<select name="outcome" required defaultValue=""><option value="" disabled>Choose a result</option><optgroup label="Positive">{options("positive")}</optgroup><optgroup label="Negative">{options("negative")}</optgroup><optgroup label="Could not check">{options("attention")}</optgroup></select></label><label>Evidence or notes<textarea name="notes" rows={3} maxLength={2000} placeholder="Required for “Removed from Nextdoor”: what message did Nextdoor show? Never paste passwords." /></label><label>Comments seen (optional)<input name="comments_total" type="number" min={0} max={10000000} placeholder="Leave blank if unknown" /></label><label className="check"><input name="reviewed" type="checkbox" required />I opened this exact post in an authorized view. A timeout or login problem is not proof of removal.</label></ActionForm>;
}

export function ObservationForm({ publicationId }: { publicationId: string }) {
  return <ActionForm action={recordObservation} label="Save manual observation"><input type="hidden" name="publication_id" value={publicationId} /><label>What did you observe?<select name="visibility" defaultValue="unknown"><option value="unknown">Unknown / could not establish</option><option value="live">Accessible in the authorized view</option><option value="unavailable">Unavailable (reason not established)</option><option value="confirmed_removed">Explicit removal confirmed</option><option value="deleted_by_owner">Deleted by owner</option></select></label><label>Observed total comments<input name="comments_total" type="number" min={0} max={10000000} placeholder="Leave blank if unavailable" /></label><label>Evidence / viewing context<textarea name="notes" maxLength={2000} rows={3} placeholder="Describe the authorized view and any explicit platform message. Do not include credentials." /></label><label className="check"><input name="complete" type="checkbox" />All available comments/replies were reviewed.</label><label className="check"><input name="reviewed" type="checkbox" required />I reviewed this exact post. A login failure or timeout is not proof of removal.</label></ActionForm>;
}

export function CommentForm({ publicationId }: { publicationId: string }) {
  return <ActionForm action={addComment} label="Record observed comment"><input type="hidden" name="publication_id" value={publicationId} /><label>Author label<input name="author_label" required maxLength={120} /></label><label>Comment text<textarea name="body" rows={3} required maxLength={5000} /></label><label>Platform comment ID (if available)<input name="source_comment_id" maxLength={200} /><span className="field-hint">Used to prevent duplicate entries. Leave unknown rather than inventing an ID.</span></label></ActionForm>;
}

export function CsvImport({ customers }: { customers: Customer[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(previewImport, {});
  return <div className="import-flow"><p className="muted small">Accepted headers: <code>title,url,account_label,published_at</code>. Dates must include a UTC/offset suffix. CSV only; up to 100 rows / 512 KB. Legacy credentials and cookie exports are rejected.</p><form action={action} className="form-grid"><WorkspaceField /><CustomerSelect customers={customers} /><label>Reviewed CSV export<input name="file" type="file" accept=".csv,text/csv" required /></label><button className="button secondary" disabled={pending}>{pending ? "Reading…" : "Preview only"}</button></form>{state.error && <p role="alert" className="notice error">{state.error}</p>}{state.errors && state.errors.length > 0 && <ul className="notice error" role="alert">{state.errors.map((error) => <li key={error}>{error}</li>)}</ul>}{state.rows && state.rows.length > 0 && <><h3>Preview · {state.rows.length} valid records</h3><div className="table-wrap"><table><thead><tr><th>Title</th><th>Account</th><th>Publication time</th></tr></thead><tbody>{state.rows.map((row) => <tr key={row.url}><td>{row.title}</td><td>{row.account_label}</td><td>{row.published_at || "Unknown"}</td></tr>)}</tbody></table></div>{state.errors?.length === 0 && <ActionForm action={confirmImport} label="Confirm import (no posting)"><input type="hidden" name="customer_id" value={state.customerId} /><input type="hidden" name="records" value={JSON.stringify(state.rows)} /><label className="check"><input name="authorized" type="checkbox" required />I reviewed this authorized customer data. Imported posts remain unverified.</label></ActionForm>}</>}</div>;
}
