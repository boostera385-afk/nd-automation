import Link from "next/link";
import { CircleCheckBig, FileSpreadsheet, Link2Off } from "lucide-react";
import { requireWorkspace } from "@/lib/data";
import { fetchMasterLayout, fetchMasterSections, sheetSyncConfigured, SheetSyncError } from "@/lib/sheet-sync";
import { describeMasterWarning, planTabCandidates, summarizeMasterSections, type MasterLayout, type MasterSections } from "@/lib/master-sections";
import { formatTime } from "@/lib/time";
import { PageHeader, Panel, StatCard } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

// A preview, not a complete export: the connector already caps rows at 2,400.
const ROWS_SHOWN_PER_SECTION = 120;

export default async function DatedPlan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organization } = await requireWorkspace(true);
  const params = await searchParams;
  const requested = typeof params.tab === "string" ? params.tab.trim().slice(0, 100) : "";
  const configured = sheetSyncConfigured(organization.id);

  let tab = requested;
  let layout: MasterLayout | null = null;
  let snapshot: MasterSections | null = null;
  let error: string | null = null;

  if (configured) {
    try {
      if (!tab) {
        layout = await fetchMasterLayout();
        const candidates = planTabCandidates(layout);
        if (candidates.length === 1) tab = candidates[0].name;
      }
      if (tab) snapshot = await fetchMasterSections(tab);
    } catch (cause) {
      const known = cause instanceof SheetSyncError;
      // A wrong tab name is the one case where listing the tabs actually helps.
      if (known && cause.code === "sheet_not_found" && !layout) {
        try { layout = await fetchMasterLayout(); } catch { layout = null; }
      }
      error = known ? cause.message : "The Sheet plan could not be read. Nothing was changed.";
    }
  }

  const candidates = layout ? planTabCandidates(layout) : [];
  const summary = snapshot ? summarizeMasterSections(snapshot.sections) : null;
  const readAt = snapshot ? formatTime(snapshot.fetchedAt, organization.time_zone) : null;

  return <>
    <PageHeader
      eyebrow="MASTER SHEET · DATED PLAN"
      title="Posting plan by day"
      description="Read your dated sections — banner, header row, tasks beneath — without retyping anything. This page only reads: no row is imported, matched to a profile, queued or published."
      actions={<><LiveRefresh /><Link className="button secondary" href="/dashboard/master-sheet">Master Sheet</Link></>}
    />

    {!configured && <Panel title="Connect your master Sheet once">
      <p>The dashboard connection has not been configured, so no plan can be read. Your existing Fudge connection is unchanged.</p>
      <p><Link className="button" href="/dashboard/settings/sheet-setup">Step-by-step connection setup</Link></p>
    </Panel>}

    {error && <p className="notice error" role="alert">{error}</p>}

    {candidates.length > 1 || (candidates.length > 0 && !snapshot) ? <Panel title={candidates.length > 1 ? "Choose a tab" : "Available tab"} hint={`${candidates.length} tab${candidates.length === 1 ? "" : "s"} with data`}>
      <p className="muted small">{candidates.length > 1 ? "More than one tab has data, so the plan tab is not guessed. " : ""}Pick the tab that holds your dated plan.</p>
      <nav className="workflow-tabs" aria-label="Sheet tabs">
        {candidates.map((entry) => <Link key={entry.name} href={`/dashboard/master-sheet/plan?tab=${encodeURIComponent(entry.name)}`} prefetch={false} aria-current={entry.name === tab ? "page" : undefined}>{entry.name}<span className="muted small"> · {entry.rows} rows</span></Link>)}
      </nav>
    </Panel> : null}

    {configured && layout && candidates.length === 0 && <p className="notice">The connected workbook has no tab containing data. Nothing was created or renamed.</p>}

    {snapshot && summary && <>
      <p className="muted small">
        {tab} · read {readAt}
        {snapshot.linkColumnSource === "declared" && " · post links read from the column you declared"}
        {snapshot.linkColumnSource === "header" && " · post links read from a recognised header"}
        {snapshot.linkColumnSource === null && " · no post-link column was recognised or declared, so no links are shown"}
      </p>

      {snapshot.warnings.length > 0 && <div className="notice" role="status">
        {snapshot.warnings.map((code) => <p key={code}>{describeMasterWarning(code)}</p>)}
      </div>}

      {snapshot.truncated && <p className="notice">Partial read: the connector stopped at its row or section limit, so these counts are a floor, not a total.</p>}

      <div className="stats-grid">
        <StatCard label="Tasks in plan" value={summary.totals.tasks} hint={`${summary.totals.sections} dated section${summary.totals.sections === 1 ? "" : "s"}`} icon={FileSpreadsheet} />
        <StatCard label="Saved post links" value={summary.totals.withLink} hint="Exact Nextdoor share URLs only" icon={CircleCheckBig} />
        <StatCard label="Posted claim with link" value={summary.totals.postedWithLink} hint="A Sheet label, not a verified observation" icon={CircleCheckBig} />
        <StatCard label="Posted claim without link" value={summary.totals.postedWithoutLink} hint="Marked posted, but no link is saved" icon={Link2Off} />
      </div>

      {(summary.totals.missingProfile > 0 || summary.totals.rejectedLinks > 0 || summary.totals.linkWithoutStatus > 0) && <p className="notice subtle">
        {summary.totals.missingProfile > 0 && <>{summary.totals.missingProfile} rows have no Account Name, so they cannot be matched to a profile yet. </>}
        {summary.totals.rejectedLinks > 0 && <>{summary.totals.rejectedLinks} link cells were not exact Nextdoor share URLs and were refused. </>}
        {summary.totals.linkWithoutStatus > 0 && <>{summary.totals.linkWithoutStatus} rows have a saved link but no status. </>}
        Nothing was repaired, guessed or written back.
      </p>}

      {snapshot.sections.length === 0 && <Panel title="No dated section found">
        <p>This tab does not look like a dated plan: no date banner above a header row was detected. If your layout differs, the connector needs an explicit mapping rather than a guess.</p>
      </Panel>}

      {snapshot.sections.map((section) => {
        const sectionSummary = summary.sections.find((entry) => entry.headerRow === section.headerRow);
        const shown = section.rows.slice(0, ROWS_SHOWN_PER_SECTION);
        return <Panel
          key={`${section.headerRow}-${section.bannerRow ?? 0}`}
          title={section.planDate ? `Plan for ${section.planDate}` : "Section with no date banner"}
          hint={`Rows ${section.fromRow}–${section.toRow} · header row ${section.headerRow}`}
        >
          {!section.planDate && <p className="notice">The date is unknown for this section because no banner sits above its header row. It is not assumed to be today.</p>}
          <p className="muted small">
            {section.rows.length} tasks · saved links {sectionSummary?.withLink ?? 0} · posted claim with link {sectionSummary?.postedWithLink ?? 0} · posted claim without link {sectionSummary?.postedWithoutLink ?? 0}
          </p>
          {sectionSummary && sectionSummary.missingProfile > 0 && <p className="notice subtle">{sectionSummary.missingProfile} of {section.rows.length} rows have no Account Name in this section, so they cannot be matched to a profile. Nothing was filled in.</p>}
          {section.rejectedLinks > 0 && <p className="notice subtle">{section.rejectedLinks} link cells in this section were not exact Nextdoor share URLs and were refused.</p>}
          {section.truncated && <p className="notice">This section was cut off at the connector&apos;s row limit.</p>}
          {section.rows.length === 0 ? <p>No task rows were found under this header.</p> : <div className="table-wrap"><table>
            <thead><tr><th>Sheet row</th><th>Account</th><th>Status</th><th>Post</th><th>Service</th><th>Area / State</th><th>Saved link</th></tr></thead>
            <tbody>{shown.map((row) => {
              const postedClaim = /^posted\b/i.test(row.status);
              return <tr key={row.rowNumber}>
                <td>{row.rowNumber}</td>
                <td>{row.profileName || <span className="muted small">Missing Account Name</span>}</td>
                <td>{postedClaim ? <span className="badge tone-attention" title="A label from the Sheet, not a verified observation">Posted (Sheet claim)</span> : row.status ? <span className="badge">{row.status}</span> : <span className="muted small">Waiting</span>}</td>
                <td>{row.title || "—"}</td>
                <td>{row.service || "—"}</td>
                <td>{[row.area, row.state].filter(Boolean).join(", ") || "—"}</td>
                <td>{row.postLink ? <span className="small status-text">{row.postLink}</span> : "—"}</td>
              </tr>;
            })}</tbody>
          </table></div>}
          {section.rows.length > shown.length && <p className="muted small">Showing the first {shown.length} of {section.rows.length} rows in this section. This is a preview, not a complete export.</p>}
        </Panel>;
      })}

      {summary.sections.some((section) => section.otherStatuses.length > 0) && <Panel title="Other status text in the Sheet" hint="Shown verbatim so nothing is silently reclassified">
        <div className="table-wrap"><table>
          <thead><tr><th>Plan date</th><th>Status text</th><th>Rows</th></tr></thead>
          <tbody>{summary.sections.flatMap((section) => section.otherStatuses.map((status) => <tr key={`${section.headerRow}-${status.text}`}><td>{section.planDate ?? "Unknown"}</td><td>{status.text}</td><td>{status.count}</td></tr>))}</tbody>
        </table></div>
      </Panel>}
    </>}

    <p className="muted small">
      Read-only: the connector calls only read methods, and phone, pictures, remarks and every credential column are never fetched.
      A <strong>Posted</strong> label stays a claim from the Sheet until a check is recorded against the saved link.
      This page does not import, map, queue or publish anything.
      {" "}<Link className="text-link" href="/dashboard/master-sheet">Open the tab-level Master Sheet preview →</Link>
    </p>
  </>;
}
