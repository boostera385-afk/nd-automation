"use client";

import { useActionState, useMemo, useState } from "react";
import type { ServiceRule } from "@/lib/service-catalog-contract";
import { compareServiceRules } from "@/lib/service-catalog-diff";
import { catalogPage } from "@/lib/service-catalog-preview";
import { activateServiceCatalog } from "@/app/actions/service-catalog";
import { WorkspaceField } from "./workspace-context";

export function ServiceCatalogReview({ selected, active, revisionId, generation, canActivate, alreadyActive, requestId }: { selected: ServiceRule[]; active: ServiceRule[]; revisionId: string; generation: number; canActivate: boolean; alreadyActive: boolean; requestId: string }) {
  const differences = useMemo(() => compareServiceRules(active, selected), [active, selected]);
  const [page, setPage] = useState(0);
  const view = catalogPage(differences, page);
  const [base] = useState({ revisionId, generation });
  const [stableRequestId] = useState(requestId);
  const [state, action, pending] = useActionState(activateServiceCatalog, {});
  const stale = base.revisionId !== revisionId || base.generation !== generation;
  return <>
    <p>{differences.filter((row) => row.kind === "added").length} added · {differences.filter((row) => row.kind === "removed").length} removed · {differences.filter((row) => row.kind === "changed").length} changed · {differences.filter((row) => row.kind === "unchanged").length} unchanged.</p>
    <p>Page {view.page + 1} of {view.pages}. Expand each rule to inspect exact before/after fields; all changes, including signal order, are shown without inferred equivalence.</p>
    {view.items.map((row, index) => <details key={view.offset + index}><summary>{row.keyword} — {row.kind}{row.fields.length ? ` (${row.fields.join(", ")})` : ""}</summary><h3>Currently published</h3><pre>{JSON.stringify(row.before, null, 2)}</pre><h3>Selected revision</h3><pre>{JSON.stringify(row.after, null, 2)}</pre></details>)}
    {view.pages > 1 && <nav aria-label="Rule comparison pages"><button type="button" disabled={view.page === 0} onClick={() => setPage(view.page - 1)}>Previous</button><button type="button" disabled={view.page + 1 >= view.pages} onClick={() => setPage(view.page + 1)}>Next</button></nav>}
    {state.success ? <p role="status">{state.success}</p> : alreadyActive ? <p>This exact revision is already active. No activation is needed.</p> : !canActivate ? <p>Only a verified owner or admin can activate rules. Operators can review and stage revisions.</p> : stale ? <p role="alert">Published configuration changed. Reload this page and review the comparison again.</p> : <form action={action} className="form-grid">
      <WorkspaceField /><input type="hidden" name="revisionId" value={base.revisionId} /><input type="hidden" name="expectedVersion" value={base.generation} /><input type="hidden" name="requestId" value={stableRequestId} />
      <label><input type="checkbox" name="confirmed" required disabled={pending} /> I reviewed this exact revision and its differences and authorize publishing it as the business configuration, including any explicit rollback. This does not start collection or apply rules to Fudge.</label>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Confirming activation…" : "Activate this exact configuration revision"}</button>
    </form>}
  </>;
}
