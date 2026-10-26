import { Download } from "lucide-react";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { sheetSyncConfigured } from "@/lib/sheet-sync";
import { EXPORT_HEADERS } from "@/lib/sheet-export";
import { PageHeader, Panel } from "@/components/ui";
import { SheetSyncPanel } from "@/components/sheet-sync-panel";

export default async function SheetSync() {
  await requireWorkspace(true);
  const { customers } = await getDashboardData();
  return <>
    <PageHeader title="Import & export" description="Bring posts and clients in from your sheet, either by reading the connected sheet or by uploading a CSV, and send current statuses back out. Nothing here writes to the sheet or posts anything." />
    <div className="notice subtle"><strong>What leaves your sheet or computer</strong><p>Only Profile Name, Post link, Status and a one-line title. Email, Password, Proxy and every other column are removed in your browser for uploads, and never read for the connected sheet. “Posted” is the desktop tool’s own report; it is not proof the post is live.</p></div>
    <Panel title="Check for new posts and clients" hint="Read-only"><SheetSyncPanel customers={customers} liveConfigured={sheetSyncConfigured()} /></Panel>
    <Panel title="Export" hint="CSV in your sheet’s own column names">
      <p className="muted">Download what the dashboard knows. The <strong>Status update</strong> column uses your sheet’s wording (Alive, Post Deleted from ND, Proxy Issue) so whoever maintains the sheet can paste it in. Other results appear in <strong>Last check result</strong>. The file can be uploaded back here later.</p>
      <form method="get" action="/dashboard/export/posts" className="filter-bar">
        <label>What to export<select name="scope" defaultValue="all"><option value="all">All posts</option><option value="needs_check">Posts that need a check</option><option value="issues">Removed, not accessible or could not check</option></select></label>
        {customers.length > 1 && <label>Customer<select name="customer" defaultValue=""><option value="">All customers</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}
        <div className="filter-actions"><button className="button secondary" type="submit"><Download size={15} aria-hidden /> Download CSV</button></div>
      </form>
      <p className="field-hint">Columns: {EXPORT_HEADERS.join(" · ")}</p>
    </Panel>
  </>;
}
