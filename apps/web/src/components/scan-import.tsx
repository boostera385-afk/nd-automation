"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { importScannedProfiles } from "@/app/actions/profiles";
import { WorkspaceField } from "./workspace-context";

/** Summary of the newest completed device scan, preformatted on the server. */
export type LatestScanSummary = { total: number; stored: number; truncated: boolean; completedText: string } | null;

export function ScanImport({ latest }: { latest: LatestScanSummary }) {
  const [state, action, pending] = useActionState(importScannedProfiles, {});
  return <div>
    {latest
      ? <p className="muted small">Last completed scan detected {latest.total} profile(s) in Incogniton({latest.stored} stored{latest.truncated ? ", capped at 500" : ""}) on {latest.completedText}. The scan reads UUID, name and group only.</p>
      : <p className="muted small">No completed detection scan yet. Queue <strong>Detect Incogniton profiles</strong> from <a href="/dashboard/run">Run automation</a> first; the automation agent on this device fills the list.</p>}
    <form action={action} className="form-grid">
      <WorkspaceField />
      <label className="check-label"><input type="checkbox" name="confirmed" required />Import the latest detected UUID/name/group list into this workspace&apos;s inventory. It never launches, creates or verifies profiles.</label>
      {latest?.truncated === true && <label className="check-label"><input type="checkbox" name="truncated_confirmed" required />The scan was capped at 500 entries. Confirm importing the capped list.</label>}
      <button className="button secondary" type="submit" disabled={pending || !latest} aria-busy={pending}>{pending ? <><LoaderCircle className="spin" size={15} aria-hidden /> Importing…</> : "Use latest device scan"}</button>
    </form>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
  </div>;
}
