import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { getOperationsData } from "@/lib/operations-data";
import { PageHeader, Panel } from "@/components/ui";
import { WorkerRegistration } from "@/components/worker-registration";
import { canManageSetup } from "@/lib/setup-access";
import { EmployeeComputerGuide } from "@/components/employee-computer-guide";

export default async function ComputerSetup() {
  const { membership } = await requireWorkspace(true);
  if (!canManageSetup(membership.role)) return <>
    <PageHeader title="Your prepared laptop" description="One-time setup is managed by your administrator. Sign-in does not install or pair a local helper." />
    <EmployeeComputerGuide />
    <p className="action-row"><a className="button" href="nd-automation://open-incogniton">Open Incogniton</a><a className="button secondary" href="nd-automation://start-profile-helper">Start profile helper</a><Link href="/dashboard/run">Run automation</Link></p>
  </>;
  const operations = await getOperationsData();
  const helpers = operations.workers.filter((worker) => worker.enabled);
  return <>
    <PageHeader title="Connect Incogniton once" description="Use the same email and password. No device-locked login, extra account or daily connection wizard." />
    <Panel title="1. Enable the Open Incogniton button"><p>On your Windows computer, open the worker folder in your downloaded project and double-click <strong>Setup Dashboard Launcher.bat</strong>. Select your existing <strong>Incogniton.exe</strong> and approve local setup. Python 3.13 with Tkinter is required; setup does not download software or request administrator access.</p>
      <p><a className="button" href="nd-automation://open-incogniton">Open Incogniton</a></p><p className="small muted">Windows and the launcher ask before opening the app. The launcher verifies the reviewed publisher and file hash. This button opens the app only—not profiles, publishing or a monitoring worker. A website cannot confirm app readiness from this link.</p>
    </Panel>
    <Panel title="2. Connect the profile/check helper"><p>This is separate from opening Incogniton. A connected helper reports profile names and runs only authorized tasks. Your password is not put in its connection file.</p>
      {helpers.length ? <><p>{helpers.length} helper connection(s) already enabled: {helpers.map((helper) => helper.name).join(", ")}. This does not prove any helper is currently running.</p><p><Link className="button secondary" href="/dashboard/profiles">Detect profiles</Link></p><details><summary>Connect another helper</summary><p>Use this only for another authorized computer. Your existing connection will not be overwritten.</p><WorkerRegistration /></details></> : operations.available ? <WorkerRegistration /> : <p role="alert">Connection state is unavailable. Refresh before creating a connection.</p>}
      <p>Double-click <strong>Connect Profile Helper.bat</strong> in the worker folder and select your downloaded private connection. No file editing is needed. Then click <a href="nd-automation://start-profile-helper">Start profile helper</a> and approve the local prompt. It runs only explicitly queued profile tasks; no DOM adapter or Playwright is needed for profile detection.</p>
      <p>Setting up a teammate&apos;s computer? On their machine, double-click <strong>Setup Employee Computer.bat</strong> once: it runs the launcher setup of step 1 and then the private-connection picker in one pass. Ask the teammate to sign up and confirm their email first, and add that exact email under <Link href="/dashboard/settings/members">Workspace members</Link>. Give them their own downloaded private connection — never yours.</p>
      <details className="workflow-details"><summary>Post-status monitoring setup</summary><p>Actual post checks additionally need a reviewed real read-only DOM adapter and the pinned worker environment. The simple profile helper does not monitor posts or guess that adapter.</p><p>From the worker folder, after that review:</p><pre>{String.raw`.\.venv\Scripts\python.exe agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json --execute --confirm-authorized`}</pre><p>Stop the profile helper first: both runners share one lock and preserve unresolved checkpoints. No automatic startup is installed. Helpers claim for an eight-hour window; a bounded in-flight task may finish afterward. Work-session authorization still controls dispatch. Never delete unresolved journals to reconnect.</p></details>
    </Panel>
    <Panel title="3. Daily use"><ol><li>Sign in normally and click Open Incogniton.</li><li>Start work in the bar above. Click Detect profiles, refresh for the completed result, then save and assign each profile to its authorized customer once.</li><li>Open Run automation for drafts, account tools and checks. Open Results for post status.</li></ol><p><Link className="button" href="/dashboard">Back to Home</Link> · <Link href="/dashboard/automation">Advanced connection/recovery controls</Link></p><p className="small muted">Sign-in works without a local helper. Profile scans/checks do not. A remembered helper is not a device restriction; permissions and exact profile ownership are still enforced.</p></Panel>
  </>;
}
