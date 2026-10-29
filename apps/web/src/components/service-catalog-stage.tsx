"use client";

import { useActionState, useEffect, useState } from "react";
import { stageServiceCatalog } from "@/app/actions/service-catalog";
import type { ServiceRule } from "@/lib/service-catalog-contract";

export function ServiceCatalogStage({ rules, expectedRevision, onBusyChange }: { rules: ServiceRule[]; expectedRevision: number; onBusyChange: (busy: boolean) => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [baseRevision] = useState(expectedRevision);
  const [state, action, pending] = useActionState(stageServiceCatalog, {});
  useEffect(() => {
    onBusyChange(pending);
    return () => onBusyChange(false);
  }, [pending, onBusyChange]);
  if (state.success) return <p role="status">{state.success}</p>;
  return <form action={action} className="form-grid">
    <h3>Stage an immutable backend revision</h3>
    <p>This explicitly sends validated service rules to your business backend. It does not activate them, replace Sheet rules or start collection. Base revision: {baseRevision}.</p>
    <input type="hidden" name="rules" value={JSON.stringify(rules)} />
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="expectedRevision" value={baseRevision} />
    <label><input type="checkbox" name="confirmed" required disabled={pending} /> I reviewed this catalog and authorize saving an inactive revision.</label>
    {state.error && <p role="alert">{state.error}</p>}
    <button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving revision…" : "Save inactive revision"}</button>
  </form>;
}
