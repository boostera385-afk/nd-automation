"use client";

import { useState } from "react";
import { CATALOG_MAX_BYTES, previewServiceCatalog, type CatalogPreview } from "@/lib/service-catalog-preview";

export function ServiceCatalogPreview() {
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <>
    <p>Choose the private <code>service-catalog.private.json</code> saved beside your workbook snapshot. Analysis stays in this browser tab: no file upload, database write or browser-storage persistence. Refreshing clears the preview.</p>
    <label>Service catalog JSON (maximum 1 MiB)<input type="file" accept=".json,application/json" disabled={busy} onChange={async (event) => {
      const file = event.currentTarget.files?.[0];
      setPreview(null); setError("");
      if (!file) return;
      if (file.size > CATALOG_MAX_BYTES) { setError("File exceeds the 1 MiB preview limit."); return; }
      setBusy(true);
      try { setPreview(previewServiceCatalog(await file.text())); }
      catch { setError("The selected file could not be read. No data was saved."); }
      finally { setBusy(false); }
    }} /></label>
    {busy && <p role="status">Checking rules locally…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <>
      <p role="status">{preview.valid ? "Structural checks passed. This is not matching-accuracy acceptance or activation." : "Resolve validation errors before any future import."} {preview.rules.length} rules inspected.</p>
      {preview.errors.length > 0 && <div role="alert"><h3>Blocking errors</h3><ul>{preview.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {preview.warnings.length > 0 && <><h3>Review warnings</h3><ul>{preview.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      <div className="table-wrap"><table><caption>Proposed rule mapping — not saved or active</caption><thead><tr><th>Source row</th><th>Keyword</th><th>Search term</th><th>Family</th><th>Subcategory</th><th>Topic required</th><th>Family inventory</th></tr></thead><tbody>{preview.rules.map((rule, index) => <tr key={index}><td>{rule.row}</td><td>{rule.keyword}</td><td>{rule.searchTerm}</td><td>{rule.family}</td><td>{rule.subcategory}</td><td>{String(rule.topicRequired ?? "unresolved")}</td><td>{String(rule.collectFamilyInventory ?? "unresolved")}</td></tr>)}</tbody></table></div>
      {preview.unmatched.length > 0 && <><h3>Request keywords needing exact mapping review</h3><p>This list comes from the supplied snapshot report, not a fresh read of all live requirements.</p><ul>{preview.unmatched.map((keyword) => <li key={keyword}>{keyword}</li>)}</ul></>}
    </>}
  </>;
}
