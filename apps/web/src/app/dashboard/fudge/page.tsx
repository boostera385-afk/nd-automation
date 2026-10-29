import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { fetchFudgeIntakeStatus } from "@/lib/fudge-intake-status";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FudgeIntake() {
  const { db, organization, user } = await requireWorkspace(true);
  if (!user.email_confirmed_at) return <>
    <PageHeader title="Fudge intake" description="Verify your email before viewing backend intake." />
    <p role="alert">Open your verification email, confirm your address, then sign in again.</p>
  </>;
  const status = await fetchFudgeIntakeStatus(db, organization.id);
  return <>
    <PageHeader title="Fudge intake" description="Read-only backend receipt metadata for your business. No collection, upload, approval or publishing starts here." />
    <Panel title="Backend receipt status">
      {!status.available ? <p role="alert">Intake status could not be verified. Check your access, backend schema and connection, then reload. This is not evidence of an empty library. No records were changed.</p> : <>
        <dl className="definition-list"><dt>Source records received</dt><dd>{status.records}</dd><dt>Stored source revisions</dt><dd>{status.revisions}</dd></dl>
        {status.records === 0 && <p>No backend source records were visible at this read. Your local Fudge library and Fudge Sheet are separate; this does not mean local reviews were lost.</p>}
      </>}
      <p className="small muted">Read completed at {status.loadedAt} (UTC). Counts and recent receipts are separate reads and may change during intake; this is not an atomic reconciliation snapshot.</p>
      <Link className="button" href="/dashboard/fudge">Reload backend receipts</Link>
    </Panel>
    {status.available && <Panel title="Recent source revision receipts">
      <p>Match record and revision IDs to the saved Fudge acknowledgment list. The checksum is backend audit metadata, not included in the v1 Fudge receipt. Observation time is collection time, not the source review publication date. No original review content or remote media is loaded here.</p>
      {status.limited && <p className="notice">Showing only the 50 most recently received revisions; this is not the complete receipt history.</p>}
      {status.recent.length === 0 ? <p>No recent revision receipts were returned.</p> : <div className="table-wrap"><table><caption>Backend revision receipts — timestamps in UTC</caption><thead><tr><th>Record ID</th><th>Revision</th><th>Revision ID</th><th>Checksum (SHA-256)</th><th>Observed</th><th>Received</th></tr></thead><tbody>{status.recent.map((row) => <tr key={row.id}><td><code>{row.record_id}</code></td><td>{row.revision}</td><td><code>{row.id}</code></td><td><code>{row.payload_sha256}</code></td><td>{new Date(row.observed_at).toISOString()}</td><td>{new Date(row.received_at).toISOString()}</td></tr>)}</tbody></table></div>}
    </Panel>}
    <Panel title="What this does not verify">
      <p>This view cannot see a device-local pending or blocked queue, detect local-only records, or prove that its queue is fully delivered. Check the Fudge setup page for local status. Backend receipt does not mean approved content, Sheet delivery, permitted media use or a verified publication.</p>
      <p>Intake upload release remains off in this extension build. Live browser acceptance, retention/deletion and an approved pilot remain separate gates. Service-keyword management and the review/Sheet bridge are not yet connected.</p>
      <Link href="/dashboard/settings">Back to settings</Link>
    </Panel>
  </>;
}
