import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { sheetSyncConfigured } from "@/lib/sheet-sync";
import { PageHeader, Panel } from "@/components/ui";

export default async function Settings() {
  const { organization, membership, isStaff } = await requireWorkspace();
  const connected = sheetSyncConfigured(organization.id);
  return <>
    <PageHeader title="Settings / More" description="One-time connections, customers and advanced tools. Everyday work stays in the five main sections." />
    {isStaff && <section id="connections"><Panel title="One-time connection setup">
      <div className="workflow-links">
        <Link href="/dashboard/automation"><strong>Pair laptop / worker</strong><small>Save the private credential locally; register once, not every day.</small></Link>
        <Link href="/dashboard/profiles"><strong>Map profiles to customers</strong><small>Saved exact-UUID mappings are reused by Sheet sync and monitoring.</small></Link>
        <Link href="/dashboard/settings/sheet-setup"><strong>Connect Master Sheet — step-by-step</strong><small>{connected ? "Connection configured. Test it or open the copy-and-paste setup guide." : "Copy connector code, create settings and test the connection here."}</small></Link>
        <Link href="/dashboard/customers"><strong>Customers</strong><small>Customer setup and business timezones.</small></Link>
        <Link href="/dashboard/fudge"><strong>Fudge intake receipts</strong><small>Read-only backend counts and revision receipts; local queue status remains in Fudge.</small></Link>
        <Link href="/dashboard/settings/services"><strong>Service keyword import preview</strong><small>Validate your private catalog locally before backend storage or rule activation.</small></Link>
      </div>
      <details className="workflow-details"><summary>Sheet connection instructions</summary><p><Link href="/dashboard/settings/sheet-setup">Open the numbered setup wizard with copy buttons and connection testing.</Link></p><p>Configure the dashboard server with SHEET_SYNC_URL, SHEET_SYNC_TOKEN and SHEET_SYNC_ORGANIZATION_ID, and deploy the separate connector in integrations/sheets/README.md. Your workspace ID is <code>{organization.id}</code>. The new Master Sheet tab preview requires the updated connector. Do not replace the desktop or Fudge Apps Script.</p><p>Keep connection tokens private. No credentials are requested in ordinary Sheet previews. Sheet writeback and live task execution beyond monitoring remain pending.</p></details>
    </Panel></section>}
    <Panel title="More tools"><div className="workflow-links"><Link href="/dashboard/reports">Advanced daily reports</Link><Link href="/dashboard/sessions">Work-session history</Link><Link href="/dashboard/posts">Detailed post ledger</Link><Link href="/dashboard/comments">Detailed comment records</Link>{isStaff && <><Link href="/dashboard/sheet-sync">CSV import / export fallback</Link><Link href="/dashboard/content">Optional content drafts & approval history</Link><Link href="/dashboard/publishing">Publishing protocol diagnostics (not enabled)</Link><Link href="/dashboard/automation">Worker health, revocation & lease recovery</Link></>}</div></Panel>
    {isStaff && <details className="workflow-details"><summary>Manual recovery tools</summary><p>Use these only for missing links or an explicit human review—not as daily data-entry requirements.</p><div className="workflow-links"><Link href="/dashboard/posts/new">Record a missing publication link</Link><Link href="/dashboard/checks">Record a manual check</Link></div></details>}
    <Panel title="Workspace"><dl className="definition-list"><dt>Name</dt><dd>{organization.name}</dd><dt>Business timezone</dt><dd>{organization.time_zone}</dd><dt>Your role</dt><dd>{membership.role}</dd></dl></Panel>
  </>;
}
