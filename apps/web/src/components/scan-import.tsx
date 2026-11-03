"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { importScannedProfiles } from "@/app/actions/profiles";
import { PROFILE_SCAN_LIMIT } from "@/lib/profiles";
import { WorkspaceField } from "./workspace-context";

/** Summary of the newest completed device scan, preformatted on the server. */
export type LatestScanSummary = { total: number; stored: number; truncated: boolean; completedText: string } | null;

export function ScanImport({ latest }: { latest: LatestScanSummary }) {
  const [state, action, pending] = useActionState(importScannedProfiles, {});
  return <div>
    {latest
      ? <p className="muted small">Last completed scan detected {latest.total} profile(s) in Incogniton ({latest.stored} stored{latest.truncated ? `, capped at ${PROFILE_SCAN_LIMIT}` : ""}) on {latest.completedText}. The scan reads UUID, name and group only.</p>
      : <p className="muted small">No completed scan yet. Click Detect profiles above, then refresh this page after your connected helper reports the result.</p>}
    <form action={action} className="form-grid">
      <WorkspaceField />
      <label className="check-label"><input type="checkbox" name="confirmed" required />Import the latest detected UUID/name/group list into this workspace&apos;s inventory. It never launches, creates or verifies profiles.</label>
      {latest?.truncated === true && <label className="check-label"><input type="checkbox" name="truncated_confirmed" required />The scan was capped at {PROFILE_SCAN_LIMIT} entries. Confirm importing the capped list.</label>}
      <button className="button secondary" type="submit" disabled={pending || !latest} aria-busy={pending}>{pending ? <><LoaderCircle className="spin" size={15} aria-hidden /> Saving…</> : "Save detected profiles"}</button>
    </form>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
  </div>;
}
