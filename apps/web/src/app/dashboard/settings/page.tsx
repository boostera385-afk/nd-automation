import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { sheetConnectionConfigured } from "@/lib/sheet-sync";
import { PageHeader, Panel } from "@/components/ui";
import { canManageSetup } from "@/lib/setup-access";
import { EmployeeComputerGuide } from "@/components/employee-computer-guide";

export default async function Settings() {
  const { organization, membership, isStaff } = await requireWorkspace();
  const connected = await sheetConnectionConfigured(organization.id);
  const manageSetup = canManageSetup(membership.role);
  return <>
    <PageHeader title="Settings / More" description="One-time connections, customers and advanced tools. Everyday work stays in the five main sections." />
    <section className="guide-banner guide-tone-blue">
      <div><h2>New here? Open the colored setup &amp; how-to guide</h2><p>Step-by-step for first-time setup, Fudge intake, ND dashboard automations, the daily rhythm and troubleshooting. Opening it starts nothing automatically.</p></div>
      <Link className="button" href="/dashboard/settings/guide">Open the guide</Link>
    </section>
    {isStaff && !manageSetup && <EmployeeComputerGuide />}
    {manageSetup && <section id="connections"><Panel title="Admin-managed setup">
      <div className="workflow-links">
        <Link href="/dashboard/settings/computer"><strong>Connect Incogniton once</strong><small>Open-app launcher and profile/check helper setup. Sign in from any computer.</small></Link>
        <Link href="/dashboard/profiles"><strong>Map profiles to customers</strong><small>Saved exact-UUID mappings are reused by Sheet sync and monitoring.</small></Link>
        <Link href="/dashboard/settings/members"><strong>Workspace members</strong><small>Add a teammate by their confirmed signup email; owners manage roles and removals.</small></Link>
        <Link href="/dashboard/settings/sheet-setup"><strong>Connect Master Sheet — 2 steps</strong><small>{connected ? "Connection configured. Test or replace it here." : "Prepare the Google connector, then paste its URL and token to save."}</small></Link>
        <Link href="/dashboard/customers"><strong>Customers</strong><small>Customer setup and business timezones.</small></Link>
        <Link href="/dashboard/fudge"><strong>Fudge intake receipts</strong><small>Read-only backend counts and revision receipts; local queue status remains in Fudge.</small></Link>
        <Link href="/dashboard/settings/services"><strong>Service keyword import preview</strong><small>Validate your private catalog locally before backend storage or rule activation.</small></Link>
        <Link href="/dashboard/settings/sheet-writeback"><strong>Sheet writeback queue</strong><small>Queue and review explicit, replay-safe write intents. Delivery stays inactive until acceptance.</small></Link>
      </div>
      <details className="workflow-details"><summary>Sheet connection instructions</summary><p><Link href="/dashboard/settings/sheet-setup">Open the 2-step wizard with copy buttons and connection testing.</Link></p><p>The connection saves in the workspace from the wizard (like the worker credential) — no hosting changes needed. Hosted environment values (<code>SHEET_SYNC_URL</code>, <code>SHEET_SYNC_TOKEN</code>, <code>SHEET_SYNC_ORGANIZATION_ID</code>) remain an optional advanced override and take precedence; your workspace ID is <code>{organization.id}</code>. The connector is a separate read-only Apps Script project: do not replace your existing Fudge Apps Script.</p><p>Keep connection tokens private. No credentials are requested in ordinary Sheet previews. Sheet writeback and live task execution beyond monitoring remain pending.</p></details>
    </Panel></section>}
    {isStaff && !manageSetup && <Panel title="Daily work"><div className="workflow-links"><Link href="/dashboard/settings/computer">Laptop help &amp; start helper</Link><Link href="/dashboard/profiles">Shared profiles &amp; saved mappings</Link><Link href="/dashboard/customers">View customers</Link><Link href="/dashboard/run">Run automation</Link><Link href="/dashboard/results">Results</Link></div></Panel>}
    <Panel title="More tools"><div className="workflow-links"><Link href="/dashboard/reports">Advanced daily reports</Link><Link href="/dashboard/sessions">Work-session history</Link><Link href="/dashboard/posts">Detailed post ledger</Link><Link href="/dashboard/comments">Detailed comment records</Link>{isStaff && <><Link href="/dashboard/sheet-sync">CSV import / export fallback</Link><Link href="/dashboard/content">Optional content drafts & approval history</Link><Link href="/dashboard/publishing">Publishing protocol diagnostics (not enabled)</Link><Link href="/dashboard/automation">Worker health, revocation & lease recovery</Link></>}</div></Panel>
    {isStaff && <details className="workflow-details"><summary>Manual recovery tools</summary><p>Use these only for missing links or an explicit human review—not as daily data-entry requirements.</p><div className="workflow-links"><Link href="/dashboard/posts/new">Record a missing publication link</Link><Link href="/dashboard/checks">Record a manual check</Link></div></details>}
    <Panel title="Workspace"><dl className="definition-list"><dt>Name</dt><dd>{organization.name}</dd><dt>Business timezone</dt><dd>{organization.time_zone}</dd><dt>Your role</dt><dd>{membership.role}</dd></dl></Panel>
  </>;
}
