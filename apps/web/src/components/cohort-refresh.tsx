"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { refreshCheckCohort } from "@/app/actions/check-cohort";
import { businessDate, shiftDay } from "@/lib/time";
import { WorkspaceField } from "./workspace-context";

export function CohortRefresh({ customers, initialDay, activeSession }: {
  customers: { id: string; name: string; time_zone: string }[]; initialDay: string; activeSession: boolean;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [customer, setCustomer] = useState("");
  const [day, setDay] = useState(initialDay);
  const [kind, setKind] = useState("posts");
  const [freshness, setFreshness] = useState("60");
  const [locked, setLocked] = useState(false);
  const [state, action, pending] = useActionState(refreshCheckCohort, {});
  const selected = customers.find((item) => item.id === customer);
  if (state.receipt) return <div className="notice success" role="status"><strong>Cohort receipt verified</strong><p>{state.receipt.total} tracked publications: {state.receipt.queued} newly queued, {state.receipt.active} reused active jobs, {state.receipt.recent} recent results, {state.receipt.blocked} blocked. No browser result was invented and no Sheet was written.</p><Link className="button" href={`/dashboard/run/cohorts/${state.receipt.cohortId}`}>Open exact cohort progress</Link></div>;
  return <form action={action} onSubmit={() => setLocked(true)} className="form-grid">
    <WorkspaceField />
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="customer" value={customer} /><input type="hidden" name="day" value={day} />
    <input type="hidden" name="kind" value={kind} /><input type="hidden" name="freshness" value={freshness} />
    <label>Customer<select required value={customer} disabled={locked || pending} onChange={(event) => {
      const next = customers.find((item) => item.id === event.target.value); setCustomer(event.target.value);
      if (next) setDay(shiftDay(businessDate(new Date(), next.time_zone), -1));
    }}><option value="" disabled>Choose an authorized customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.time_zone}</option>)}</select></label>
    <label>Publication business date<input type="date" required value={day} readOnly={locked} disabled={pending} onChange={(event) => setDay(event.target.value)} /></label>
    {selected && <p className="small">Date is interpreted in {selected.time_zone}, including DST; it must be earlier than today there.</p>}
    <label>Publication scope<select value={kind} disabled={locked || pending} onChange={(event) => setKind(event.target.value)}><option value="posts">Posts only</option><option value="listings">Listings only</option><option value="both">Both, explicitly</option></select></label>
    <label>Keep existing checks recent for<select value={freshness} disabled={locked || pending} onChange={(event) => setFreshness(event.target.value)}><option value="60">1 hour (explicit refresh policy v1)</option><option value="240">4 hours</option><option value="1440">24 hours</option></select></label>
    <p className="small">At most 500 known-dated tracked records. Unknown dates are counted separately; missing links outside the ledger cannot be counted. Profiles must already be explicitly authorized in this work session. Normal due monitoring may continue separately.</p>
    <label className="check"><input name="confirmed" type="checkbox" required disabled={pending} />I authorize read-only checks of this exact customer/date/scope. Do not publish, enable profiles, or write Sheets.</label>
    {!activeSession && <p className="notice">Start or resume work first. This form never authorizes profiles or starts a worker.</p>}
    {locked && <p className="notice">Request inputs are locked after submission. If the response is unconfirmed, retry this same form or reconcile saved cohort history before creating a new request.</p>}
    {state.error && <p className="notice error" role="alert">{state.error}</p>}
    <button className="button" disabled={pending || !activeSession || !customer}>{pending ? "Saving exact cohort…" : "Refresh post statuses"}</button>
  </form>;
}
