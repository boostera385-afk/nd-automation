"use client";

import { useActionState, useState } from "react";
import { Download, FileUp, LoaderCircle, PlugZap, RefreshCcw, ShieldCheck } from "lucide-react";
import { importSheetPosts, runSheetAnalysis, type SyncState } from "@/app/actions/sheet-sync";
import type { FormState } from "@/app/actions/auth";
import { healthToCsv, type HealthReport, type Severity } from "@/lib/sheet-health";
import { SHEET_TABS, statusKinds, type StatusKind, type SyncView, type Tone } from "@/lib/sheet-status";
import { MAX_UPLOAD_BYTES, rowsFromCsv, type TableImport } from "@/lib/sheet-table";
import type { Customer } from "@/lib/types";
import { visibilityLabels } from "./ui";

const toneClass: Record<Tone, string> = { ok: "live", warn: "unknown", bad: "unavailable", neutral: "" };
const order: StatusKind[] = ["posted", "alive", "deleted", "proxy_issue", "posted_no_link", "posted_bad_link", "failed", "failed_retryable", "stopped", "claimed", "other", "pending"];

function KindBadge({ kind }: { kind: StatusKind }) {
  const info = statusKinds[kind];
  return <span className={`badge ${toneClass[info.tone]}`} title={info.hint}><span className="badge-dot" aria-hidden />{info.label}</span>;
}

const severityClass: Record<Severity, string> = { high: "unavailable", medium: "unknown", low: "" };
const severityLabel: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

function downloadChecklist(report: HealthReport, sheet: string) {
  const blob = new Blob([healthToCsv(report, sheet)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sheet-cleaning-checklist-${sheet.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function HealthSection({ report, sheet }: { report: HealthReport; sheet: string }) {
  const clean = report.issues.every((issue) => issue.severity === "low");
  return <section aria-labelledby="health-heading">
    <h3 id="health-heading">Sheet health</h3>
    <p className={`notice ${clean ? "success" : ""}`} role="status">{clean
      ? `No blocking problems found in ${report.totalRows} rows.${report.issues.length ? " Only minor wording differences remain." : " This data looks clean."}`
      : `${report.rowsNeedingAction} of ${report.totalRows} rows need action; ${report.cleanRows} are clean.`}</p>
    {report.issues.map((issue) => <details key={issue.code} className="health-issue">
      <summary><span className={`badge ${severityClass[issue.severity]}`}>{severityLabel[issue.severity]}</span><strong>{issue.title}</strong><span className="muted">{issue.total} {issue.total === 1 ? "row" : "rows"}</span></summary>
      <p className="muted">{issue.why}</p>
      <p><strong>How to fix:</strong> {issue.fix}</p>
      <div className="table-wrap"><table><thead><tr><th>Sheet row</th><th>Profile</th><th>Detail</th></tr></thead><tbody>{issue.rows.map((row) => <tr key={`${issue.code}-${row.rowNumber}`}><td>{row.rowNumber}</td><td>{row.profileName || <span className="muted">—</span>}</td><td className="status-text">{row.note || <span className="muted">—</span>}</td></tr>)}</tbody></table></div>
      {issue.total > issue.rows.length && <p className="muted small">Showing the first {issue.rows.length} of {issue.total} rows.</p>}
    </details>)}
    {report.issues.length > 0 && <button type="button" className="button secondary" onClick={() => downloadChecklist(report, sheet)}><Download size={15} aria-hidden /> Download cleaning checklist (CSV)</button>}
  </section>;
}

type Decision = { mode: "unset" } | { mode: "existing"; customerId: string } | { mode: "new"; name: string } | { mode: "skip" };

function initialDecisions(view: SyncView): Record<string, Decision> {
  return Object.fromEntries(view.profiles.map((group) => [group.profile, group.knownCustomerIds.length === 1 ? { mode: "existing", customerId: group.knownCustomerIds[0] } as Decision : { mode: "unset" } as Decision]));
}

// Only decided profiles are sent; the server refuses to import a post whose profile has no decision.
function toAssignments(decisions: Record<string, Decision>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [profile, decision] of Object.entries(decisions)) {
    if (decision.mode === "existing") result[profile] = { mode: "existing", customerId: decision.customerId };
    else if (decision.mode === "new") result[profile] = { mode: "new", name: decision.name.trim() };
    else if (decision.mode === "skip") result[profile] = { mode: "skip" };
  }
  return result;
}

const encode = (decision: Decision | undefined) => (decision?.mode === "existing" ? `c:${decision.customerId}` : decision?.mode === "new" ? "new" : decision?.mode === "skip" ? "skip" : "");

function ImportEditor({ view, customers }: { view: SyncView; customers: Customer[] }) {
  const [decisions, setDecisions] = useState(() => initialDecisions(view));
  const [state, action, pending] = useActionState<FormState, FormData>(importSheetPosts, {});
  const clientName = new Map(customers.map((customer) => [customer.id, customer.name]));
  const newProfiles = view.profiles.filter((group) => group.knownCustomerIds.length === 0).length;
  const decided = (decision: Decision | undefined) => decision !== undefined && (decision.mode === "existing" || decision.mode === "skip" || (decision.mode === "new" && decision.name.trim().length >= 2));
  const ready = view.profiles.length > 0 && view.profiles.every((group) => decided(decisions[group.profile]));
  const assignments = JSON.stringify(toAssignments(decisions));

  const choose = (profile: string, value: string) => setDecisions((current) => ({ ...current, [profile]: value.startsWith("c:") ? { mode: "existing", customerId: value.slice(2) } : value === "new" ? { mode: "new", name: current[profile]?.mode === "new" ? current[profile].name : "" } : value === "skip" ? { mode: "skip" } : { mode: "unset" } }));
  const chooseAll = (value: string) => setDecisions((current) => Object.fromEntries(Object.entries(current).map(([profile, decision]) => [profile, decision.mode !== "unset" ? decision : value === "skip" ? { mode: "skip" } as Decision : { mode: "existing", customerId: value.slice(2) } as Decision])));

  if (view.importable.length === 0) return <p className="muted">No new posted links to import. Everything with a usable link is already in the dashboard.</p>;
  if (state.success) return <p className="notice success" role="status">{state.success}</p>;
  return <>
    <p className="muted">{view.importableTotal} new {view.importableTotal === 1 ? "post" : "posts"} from {view.profiles.length} {view.profiles.length === 1 ? "profile" : "profiles"}{newProfiles > 0 && <> · <strong>{newProfiles} new {newProfiles === 1 ? "profile has" : "profiles have"} no client yet</strong></>}. Choose the client each profile belongs to.</p>
    {view.importableTotal > view.importable.length && <p className="notice">Showing the first {view.importable.length} of {view.importableTotal}. Import these, then analyse again for the rest.</p>}
    <div className="assign-tools"><label>Set every undecided profile to<select value="" onChange={(event) => chooseAll(event.target.value)}><option value="">Choose…</option>{customers.map((customer) => <option key={customer.id} value={`c:${customer.id}`}>{customer.name}</option>)}<option value="skip">Skip (do not import)</option></select></label></div>
    <div className="table-wrap"><table className="assign-table"><thead><tr><th>Profile</th><th>New posts</th><th>Known client</th><th>Client for these posts</th></tr></thead><tbody>
      {view.profiles.map((group) => { const decision = decisions[group.profile]; const known = group.knownCustomerIds; return <tr key={group.profile}>
        <td>{group.profile}</td><td>{group.posts}</td>
        <td>{known.length === 0 ? <span className="badge unknown"><span className="badge-dot" aria-hidden />New profile</span> : known.length === 1 ? <span className="badge live"><span className="badge-dot" aria-hidden />{clientName.get(known[0]) ?? "Known client"}</span> : <span className="badge unknown" title={known.map((id) => clientName.get(id) ?? "client").join(", ")}><span className="badge-dot" aria-hidden />Several clients</span>}</td>
        <td><select aria-label={`Client for ${group.profile}`} value={encode(decision)} onChange={(event) => choose(group.profile, event.target.value)}><option value="">Choose a client…</option>{customers.map((customer) => <option key={customer.id} value={`c:${customer.id}`}>{customer.name}</option>)}<option value="new">＋ Create a new client…</option><option value="skip">Skip (do not import)</option></select>{decision?.mode === "new" && <input className="new-client" aria-label={`New client name for ${group.profile}`} placeholder="Client or business name" maxLength={120} value={decision.name} onChange={(event) => setDecisions((current) => ({ ...current, [group.profile]: { mode: "new", name: event.target.value } }))} />}</td>
      </tr>; })}
    </tbody></table></div>
    <h4 className="sub-heading">Posts to be saved</h4>
    <div className="table-wrap"><table><thead><tr><th>Title (from sheet)</th><th>Profile</th><th>Link</th></tr></thead><tbody>{view.importable.map((row) => <tr key={row.url}><td>{row.title}</td><td>{row.account_label}</td><td><a href={row.url} target="_blank" rel="noopener noreferrer">Open</a></td></tr>)}</tbody></table></div>
    <form action={action} className="form-grid">
      <input type="hidden" name="records" value={JSON.stringify(view.importable)} />
      <input type="hidden" name="assignments" value={assignments} />
      <label className="check"><input name="authorized" type="checkbox" required />I reviewed this authorized customer data. Posts are saved as “not checked” with an unknown publication date until someone checks them.</label>
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      {!ready && <p className="field-hint">Choose a client for every profile, or skip it, to continue.</p>}
      <button className="button" type="submit" disabled={!ready || pending} aria-busy={pending}>{pending ? <><LoaderCircle className="spin" size={15} aria-hidden /> Saving…</> : `Save ${view.importable.length} posts`}</button>
    </form>
  </>;
}

type UploadInfo = { fileName: string; result?: TableImport; error?: string };

export function SheetSyncPanel({ customers, liveConfigured }: { customers: Customer[]; liveConfigured: boolean }) {
  const [state, action, pending] = useActionState<SyncState, FormData>(runSheetAnalysis, {});
  const [source, setSource] = useState<"live" | "upload">(liveConfigured ? "live" : "upload");
  const [upload, setUpload] = useState<UploadInfo | null>(null);
  const view = state.view;
  const result = upload?.result;
  const uploadReady = Boolean(result && !result.error && result.rows.length > 0);

  async function readFile(file: File | undefined) {
    if (!file) { setUpload(null); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setUpload({ fileName: file.name, error: "That file is larger than 5 MB. Export just the one tab you need." }); return; }
    if (/\.xlsx?$/i.test(file.name)) { setUpload({ fileName: file.name, error: "Excel workbooks are not supported yet. In Google Sheets or Excel choose File → Download / Save as → CSV for the tab you want, then upload that file." }); return; }
    setUpload({ fileName: file.name, result: rowsFromCsv(await file.text()) });
  }

  return <div className="import-flow">
    <form action={action} className="sync-source">
      <fieldset className="source-picker">
        <legend className="sr-only">Where should the data come from?</legend>
        <label className={`source-card ${source === "live" ? "is-on" : ""} ${liveConfigured ? "" : "is-off"}`}><input type="radio" name="source" value="live" checked={source === "live"} disabled={!liveConfigured} onChange={() => setSource("live")} /><span><strong><PlugZap size={16} aria-hidden /> Connected sheet</strong><small>{liveConfigured ? "Reads your Google Sheet directly. Read-only." : "Not set up yet. Steps are in integrations/sheets/README.md."}</small></span></label>
        <label className={`source-card ${source === "upload" ? "is-on" : ""}`}><input type="radio" name="source" value="upload" checked={source === "upload"} onChange={() => setSource("upload")} /><span><strong><FileUp size={16} aria-hidden /> Upload a CSV file</strong><small>Export a tab as CSV. Works right now, no setup.</small></span></label>
      </fieldset>

      {source === "live" ? <label className="source-field">Sheet tab<select name="sheet" defaultValue={SHEET_TABS[0]}>{SHEET_TABS.map((tab) => <option key={tab} value={tab}>{tab}</option>)}</select></label> : <div className="upload-box">
        <label className="source-field">CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} /></label>
        <p className="field-hint">In Google Sheets: open the tab → File → Download → Comma-separated values (.csv). Keep the header row.</p>
        {upload?.error && <p className="notice error" role="alert">{upload.error}</p>}
        {result?.error && <p className="notice error" role="alert">{result.error}</p>}
        {result && !result.error && <div className="upload-summary" role="status">
          <p><strong>{result.rows.length} {result.rows.length === 1 ? "row" : "rows"}</strong> read from {upload?.fileName}. Using: {Object.values(result.used).join(" · ")}.</p>
          {result.sensitiveIgnored.length > 0 && <p className="privacy-note"><ShieldCheck size={16} aria-hidden /> Left out in your browser and <strong>never uploaded</strong>: {result.sensitiveIgnored.join(", ")}.</p>}
          {result.ignoredColumns.filter((name) => !result.sensitiveIgnored.includes(name)).length > 0 && <p className="muted small">Also ignored: {result.ignoredColumns.filter((name) => !result.sensitiveIgnored.includes(name)).join(", ")}.</p>}
          {result.truncated && <p className="notice">Only the first 1,500 rows are used. Export a smaller range for the rest.</p>}
        </div>}
        <input type="hidden" name="rows" value={uploadReady && result ? JSON.stringify(result.rows) : ""} />
        <input type="hidden" name="label" value={upload?.fileName ?? ""} />
        <input type="hidden" name="truncated" value={result?.truncated ? "1" : "0"} />
      </div>}

      <div className="filter-actions"><button className="button" type="submit" disabled={pending || (source === "upload" && !uploadReady) || (source === "live" && !liveConfigured)} aria-busy={pending}>{pending ? <><LoaderCircle className="spin" size={15} aria-hidden /> Analysing…</> : <><RefreshCcw size={15} aria-hidden /> {source === "live" ? "Check the sheet" : "Analyse this file"}</>}</button></div>
    </form>

    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {view && <>
      <p className="notice success" role="status">{state.success} {state.source === "live" ? `Read at ${state.fetchedAt ? new Date(state.fetchedAt).toLocaleString() : "an unknown time"}` : "Uploaded file"} · {state.sheet}.</p>
      {state.sourceTruncated && <p className="notice error">The source has more rows than one pass returns. Later rows are not shown.</p>}
      {state.dashboardPartial && <p className="notice">Loaded-data limit reached on the dashboard side, so “already in dashboard” may be understated. Duplicate links are still skipped on import.</p>}
      {state.health && <HealthSection report={state.health} sheet={state.sheet ?? "Sheet"} />}
      <h3>{view.total} rows by status</h3>
      <div className="sync-summary">{order.filter((kind) => view.counts[kind] > 0).map((kind) => <article key={kind} className="sync-card"><strong>{view.counts[kind]}</strong><KindBadge kind={kind} /><small>{statusKinds[kind].hint}</small></article>)}</div>
      {view.inDashboard > 0 && <p className="muted">{view.inDashboard} posted links are already in the dashboard. Their latest manual observation: {Object.entries(view.crossCheck).map(([key, count]) => `${visibilityLabels[key as keyof typeof visibilityLabels]} ${count}`).join(" · ")}. “Posted” in the sheet is the desktop tool’s report, not an observation.</p>}
      {view.duplicateLinks > 0 && <p className="muted">{view.duplicateLinks} rows repeat a link already counted above and are ignored.</p>}

      {view.attentionTotal > 0 && <><h3>Needs attention · {view.attentionTotal}{view.attentionTotal > view.attention.length ? ` (showing ${view.attention.length})` : ""}</h3><div className="table-wrap"><table><thead><tr><th>Sheet row</th><th>Profile</th><th>Result</th><th>Status text in sheet</th></tr></thead><tbody>{view.attention.map((item) => <tr key={item.rowNumber}><td>{item.rowNumber}</td><td>{item.profileName || <span className="muted">—</span>}</td><td><KindBadge kind={item.kind} /></td><td className="status-text">{item.status || <span className="muted">—</span>}</td></tr>)}</tbody></table></div></>}

      <h3>New posts and clients · {view.importableTotal}</h3>
      <ImportEditor key={`${state.fetchedAt}-${state.sheet}`} view={view} customers={customers} />
    </>}
  </div>;
}
