import Link from "next/link";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { MASTER_TABS } from "@/lib/workflow";
import { fetchMasterRows, sheetSyncConfigured, SheetSyncError } from "@/lib/sheet-sync";
import { formatTime } from "@/lib/time";
import { PageHeader, Panel } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { ActionForm } from "@/components/action-form";
import { syncMappedPosts } from "@/app/actions/workflow";

export default async function MasterSheet({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organization } = await requireWorkspace(true);
  const params = await searchParams;
  const parsed = z.enum(MASTER_TABS).safeParse(params.tab);
  const tab = parsed.success ? parsed.data : MASTER_TABS[0];
  const configured = sheetSyncConfigured(organization.id);
  let snapshot: Awaited<ReturnType<typeof fetchMasterRows>> | null = null;
  let error: string | null = null;
  let optionalProxyTabMissing = false;
  if (configured) {
    try { snapshot = await fetchMasterRows(tab); }
    catch (cause) {
      if (cause instanceof SheetSyncError && cause.code === "sheet_not_found" && tab === "Bulk proxies import") optionalProxyTabMissing = true;
      else error = cause instanceof SheetSyncError ? cause.message : "The master Sheet could not be read. Nothing was changed.";
    }
  }
  return <>
    <PageHeader eyebrow="YOUR EXISTING WORKFLOW" title="Master Sheet" description="Keep cleaning your data in the same Sheet. See its task tabs here without retyping posts or importing credentials." actions={<LiveRefresh />} />
    <nav className="workflow-tabs" aria-label="Master Sheet tabs">{MASTER_TABS.map((item) => <Link key={item} href={`/dashboard/master-sheet?tab=${encodeURIComponent(item)}`} prefetch={false} aria-current={item === tab ? "page" : undefined}>{item}</Link>)}</nav>
    {!configured && <Panel title="Connect your master Sheet once"><p>The dashboard connection has not been configured. Your existing desktop and Fudge connections are unchanged.</p><p><Link className="button" href="/dashboard/settings/sheet-setup">Step-by-step connection setup</Link> <Link className="text-link" href="/dashboard/sheet-sync">CSV fallback</Link></p></Panel>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {optionalProxyTabMissing && <Panel title="Optional proxy-import tab not configured">
      <p>The connected Sheet does not contain a separate Bulk proxies import tab. No tab was created or renamed, and no proxy task was queued.</p>
      <p>If your legacy tab is named Bulk proxy import and has a Cookies column, its safe metadata appears under <Link className="text-link" href="/dashboard/master-sheet?tab=Bulk%20cookies%20import" prefetch={false}>Bulk cookies import</Link>. Cookie and proxy imports are different tasks; cookie values are never read by this preview.</p>
      <p className="muted small">You can continue using the other available Sheet tabs. Only this optional tab is absent; this response is not evidence of worker or browser readiness.</p>
    </Panel>}
    {snapshot && <>
      <Panel title={tab} hint={`Read ${formatTime(snapshot.fetchedAt, organization.time_zone)}`}>
        <p className="muted small">Safe preview: profile, short title, execution status and link only. Secret columns are never read. Empty Status means waiting in the Sheet, not validated or queued by this dashboard.</p>
        {snapshot.truncated && <p className="notice">Partial source: the connector read only its first 2,000 rows.</p>}
        {snapshot.rows.length ? <div className="table-wrap"><table><thead><tr><th>Sheet row</th><th>Profile</th><th>Title</th><th>Execution status</th><th>Post link</th></tr></thead><tbody>{snapshot.rows.slice(0, 200).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.profileName || "Missing profile"}</td><td>{row.title || "—"}</td><td>{row.status || "Waiting in Sheet"}</td><td>{row.postLink ? <span className="small status-text">{row.postLink}</span> : "—"}</td></tr>)}</tbody></table></div> : <p>No named task metadata was found in this tab. Unheaded side-column data is not treated as work.</p>}
        {snapshot.rows.length > 200 && <p className="muted small">Showing the first 200 of {snapshot.rows.length} returned rows. This is a preview, not a complete inventory.</p>}
      </Panel>
      {(tab === "Auto Posting" || tab === "Auto Listing") && <Panel title="Sync posted links" hint="Uses your saved profile/customer mappings"><p>Save reported post links to Results. Known mappings are reused; missing or ambiguous mappings are skipped for review. This does not post, alter Sheet values or mark anything live.</p><ActionForm key={tab} action={syncMappedPosts} label="Sync known profiles now"><input type="hidden" name="sheet" value={tab} /></ActionForm><p className="small muted">Need a mapping? <Link href="/dashboard/profiles">Assign profiles once</Link>. Unusual rows can use the <Link href="/dashboard/sheet-sync">advanced import fallback</Link>.</p></Panel>}
    </>}
    <p className="muted small">Fudge source data → your cleanup → master Sheet → local automation → Results. The dashboard never runs a browser task simply because this page is open. Sheet writeback is not connected yet.</p>
  </>;
}
