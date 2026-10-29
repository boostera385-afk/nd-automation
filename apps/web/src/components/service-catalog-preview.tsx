"use client";

import { useMemo, useRef, useState } from "react";
import { CATALOG_MAX_BYTES, catalogPage, previewServiceCatalog, type CatalogPreview } from "@/lib/service-catalog-preview";
import { rulesFromCatalogPreview } from "@/lib/service-catalog-contract";
import { ServiceCatalogStage } from "./service-catalog-stage";

function PageControls({ page, pages, label, change }: { page: number; pages: number; label: string; change: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav aria-label={`${label} pages`}><button type="button" disabled={page === 0} onClick={() => change(page - 1)}>Previous</button><span role="status"> Page {page + 1} of {pages} </span><button type="button" disabled={page + 1 >= pages} onClick={() => change(page + 1)}>Next</button></nav>;
}
function PagedMessages({ items, label }: { items: string[]; label: string }) {
  const [requested, setPage] = useState(0);
  const view = catalogPage(items, requested);
  return <><p>{view.total} {label.toLowerCase()}; showing {view.offset + 1}–{view.offset + view.items.length}.</p><ul>{view.items.map((item, index) => <li key={view.offset + index}>{item}</li>)}</ul><PageControls {...view} label={label} change={setPage} /></>;
}

export function ServiceCatalogPreview({ expectedRevision }: { expectedRevision?: number } = {}) {
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [generation, setGeneration] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const rules = catalogPage(preview?.rules ?? [], page);
  const stagedRules = useMemo(() => preview ? rulesFromCatalogPreview(preview) : null, [preview]);
  return <>
    <p>Choose the private <code>service-catalog.private.json</code> saved beside your workbook snapshot. Analysis stays in this browser tab: no file upload, database write or browser-storage persistence during preview. Only the separate Save inactive revision action sends validated rules to the backend. Refreshing clears the preview.</p>
    <label>Service catalog JSON (maximum 1 MiB)<input ref={fileInput} type="file" accept=".json,application/json" disabled={busy || saving} onChange={async (event) => {
      const file = event.currentTarget.files?.[0];
      setPreview(null); setError(""); setPage(0); setGeneration((value) => value + 1);
      if (!file) return;
      if (file.size > CATALOG_MAX_BYTES) { setError("File exceeds the 1 MiB preview limit."); return; }
      setBusy(true);
      try { setPreview(previewServiceCatalog(await file.text())); }
      catch { setError("The selected file could not be read. No data was saved."); }
      finally { setBusy(false); }
    }} /></label>
    {(preview || error) && <button type="button" disabled={busy || saving} onClick={() => {
      setPreview(null); setError(""); setPage(0);
      if (fileInput.current) fileInput.current.value = "";
    }}>Clear local preview</button>}
    {busy && <p role="status">Checking rules locally…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <>
      <p role="status">{preview.valid ? "Structural checks passed. This is not matching-accuracy acceptance or activation." : "Resolve validation errors before any future import."} {preview.rules.length} rules inspected.</p>
      {preview.errors.length > 0 && <div role="alert"><h3>Blocking errors</h3><PagedMessages key={`errors-${generation}`} items={preview.errors} label="Blocking errors" /></div>}
      {preview.warnings.length > 0 && <><h3>Review warnings</h3><PagedMessages key={`warnings-${generation}`} items={preview.warnings} label="Warnings" /></>}
      <p>Rule page {rules.page + 1} of {rules.pages}; up to 25 rows rendered at a time.</p>
      <div className="table-wrap"><table><caption>Proposed rule mapping — not saved or active</caption><thead><tr><th>Source row</th><th>Keyword</th><th>Search term</th><th>Family</th><th>Subcategory</th><th>Topic required</th><th>Family inventory</th></tr></thead><tbody>{rules.items.map((rule, index) => <tr key={rules.offset + index}><td>{rule.row}</td><td>{rule.keyword}</td><td>{rule.searchTerm}</td><td>{rule.family}</td><td>{rule.subcategory}</td><td>{String(rule.topicRequired ?? "unresolved")}</td><td>{String(rule.collectFamilyInventory ?? "unresolved")}</td></tr>)}</tbody></table></div>
      <PageControls {...rules} label="Rules" change={setPage} />
      {preview.unmatched.length > 0 && <><h3>Request keywords needing exact mapping review</h3><p>This list comes from the supplied snapshot report, not a fresh read of all live requirements.</p><PagedMessages key={`unmatched-${generation}`} items={preview.unmatched} label="Unmatched keywords" /></>}
      {preview.valid && !stagedRules && <p role="alert">Preview fields exceed the backend contract limits. Resolve term/count/byte limits before staging; no save is available.</p>}
      {stagedRules && expectedRevision !== undefined && <ServiceCatalogStage key={generation} rules={stagedRules} expectedRevision={expectedRevision} onBusyChange={setSaving} />}
    </>}
  </>;
}
