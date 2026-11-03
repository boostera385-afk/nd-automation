"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { enqueueBrowserTask } from "@/app/actions/automation-tasks";
import { WorkspaceField } from "./workspace-context";
import { LocalHelperField } from "./local-helper-field";

export function ComputerControls({ workers, activeSession, available }: { workers: Array<{ id: string; name: string; enabled: boolean }>; activeSession: boolean; available: boolean }) {
  const [state, action, pending] = useActionState(enqueueBrowserTask, {});
  const [launchRequested, setLaunchRequested] = useState(false);
  const helpers = workers.filter((worker) => worker.enabled);
  return <div className="computer-controls">
    <p>Use your usual email to sign in from any computer. Install the local launcher once on a Windows computer where you want to open Incogniton.</p>
    <div className="action-row"><a className="button" href="nd-automation://open-incogniton" onClick={() => setLaunchRequested(true)}>Open Incogniton</a><a className="button secondary" href="nd-automation://start-profile-helper" onClick={() => setLaunchRequested(true)}>Start profile helper</a><Link className="button secondary" href="/dashboard/settings/computer">One-time computer setup</Link><Link className="button secondary" href="/dashboard/results">View post status</Link></div>
    {launchRequested && <p role="status">Request sent to Windows. Approve the local prompt. This page cannot verify that the app/helper started; if nothing happens, complete one-time computer setup.</p>}
    <p className="small muted">Open Incogniton acts on the computer you click from. Profile detection runs on the connected helper named below; it may be on another computer. Sign-in alone does not connect a helper.</p>
    {!available ? <p className="notice">Profile detection is unavailable. Check connection setup; no scan can be queued.</p> : helpers.length === 0 ? <p>Connect your local helper once to detect profiles. No device registration is needed just to sign in or view reports.</p> : <form action={action} className="form-grid">
      <WorkspaceField />
      <input type="hidden" name="kind" value="inventory_scan" /><input type="hidden" name="confirmed" value="on" />
      <LocalHelperField helpers={helpers} />
      <p className="small">Detect reads profile names, groups and IDs only. It does not open profiles or read cookies. Clicking the button authorizes this scan during your current work session.</p>
      {!activeSession && <p className="notice">Click Start work or Resume in the bar above, then detect profiles.</p>}
      <button className="button secondary" type="submit" disabled={pending || !activeSession}>{pending ? "Requesting scan…" : "Detect profiles"}</button>
      {state.error && <p role="alert" className="notice error">{state.error}</p>}{state.success && <p role="status" className="notice success">{state.success} <Link href="/dashboard/profiles">View detected profiles</Link></p>}
    </form>}
  </div>;
}
