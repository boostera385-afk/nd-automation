import Link from "next/link";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { setPublicationSheetMapping, setPublishSheetTarget } from "@/app/actions/sheet-writeback";

const mappingShape = z.object({ publication_id: z.uuid(), tab: z.enum(["Auto Posting", "Auto Listing"]), row_id: z.uuid(),
  next_revision: z.number().int().positive(), enabled: z.boolean() }).strict();
const targetShape = z.object({ binding_id: z.uuid(), enabled: z.boolean(), include_checks: z.boolean() }).strict();
const eventShape = z.object({ event_kind: z.enum(["publish", "check"]), event_id: z.uuid(), publication_id: z.uuid(),
  outbox_id: z.uuid().nullable(), disposition: z.enum(["queued", "skipped_authorization"]), created_at: z.iso.datetime({ offset: true }) }).strict();

export default async function SheetMapping() {
  const { db, organization } = await requireWorkspace(true);
  const header = <PageHeader title="Automatic result-to-Sheet mapping" description="Explicit future-result policies. Configuration never publishes content or writes Google directly." />;
  const protocol = await db.rpc("reporting_sheet_mapping_version").abortSignal(AbortSignal.timeout(15000));
  if (protocol.error || protocol.data !== 1) return <>{header}<Panel title="Mapping source is not deployed"><p>The reviewed automatic-mapping migration is not available. No mapping or replay is enabled by this page.</p></Panel></>;
  const [mappings, targets, events] = await Promise.all([
    db.from("reporting_sheet_publication_mappings").select("publication_id,tab,row_id,next_revision,enabled").eq("organization_id", organization.id).order("updated_at", { ascending: false }).limit(26).abortSignal(AbortSignal.timeout(15000)),
    db.from("reporting_sheet_publish_targets").select("binding_id,enabled,include_checks").eq("organization_id", organization.id).order("updated_at", { ascending: false }).limit(26).abortSignal(AbortSignal.timeout(15000)),
    db.from("reporting_sheet_delivery_events").select("event_kind,event_id,publication_id,outbox_id,disposition,created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(26).abortSignal(AbortSignal.timeout(15000)),
  ]);
  const mapped = z.array(mappingShape).max(26).safeParse(mappings.data);
  const assigned = z.array(targetShape).max(26).safeParse(targets.data);
  const observed = z.array(eventShape).max(26).safeParse(events.data);
  if (mappings.error || targets.error || events.error || !mapped.success || !assigned.success || !observed.success) {
    return <>{header}<p role="alert">Saved mapping state could not be verified. No mutation controls are offered; refresh before changing configuration.</p></>;
  }
  return <>{header}
    <Panel title="Map future checks for one existing publication"><p>Review the actual Sheet row first. The stable UUID must already exist once in ND Row ID, and the revision must match ND Revision. Reserve these columns to the connector; do not race human/other-script edits. No row-number guess or historical replay is allowed.</p>
      <ActionForm action={setPublicationSheetMapping} label="Save exact publication mapping">
        <label>Publication UUID<input name="publication" required /></label><label>Tab<select name="tab"><option>Auto Posting</option><option>Auto Listing</option></select></label>
        <label>Existing ND Row ID UUID<input name="row" required /></label><label>Current ND Revision<input name="revision" type="number" min={1} max={999999997} required defaultValue={1} /></label>
        <label>Future check mapping<select name="enabled" defaultValue="false"><option value="false">Paused</option><option value="true">Enabled</option></select></label>
        <label><input type="checkbox" name="confirmed" required /> I verified the exact publication, stable Sheet row, current revision and column ownership. I authorize only future sourced results; technical failures must not be presented as removals.</label>
      </ActionForm>
    </Panel>
    <Panel title="Map future confirmed publications for one assignment"><p>Only a newly confirmed submitted publication queues an append. The publication UUID becomes its ND Row ID. Optional check mapping starts at revision 1 after that append. Ambiguous/failed submissions never create Sheet publication rows. Pausing this policy does not pause existing publication mappings or cancel their queued writes.</p>
      <ActionForm action={setPublishSheetTarget} label="Save future publication policy">
        <label>Exact profile-assignment UUID<input name="binding" required /></label>
        <label>Append future confirmed publications<select name="enabled" defaultValue="false"><option value="false">Paused</option><option value="true">Enabled</option></select></label>
        <label>Map checks for newly appended publications<select name="checks" defaultValue="false"><option value="false">No</option><option value="true">Yes</option></select></label>
        <label><input type="checkbox" name="confirmed" required /> I reviewed this customer/account assignment and the authorized target Sheet/columns. This is future-result mapping only, not permission to publish or replay existing data.</label>
      </ActionForm>
    </Panel>
    <Panel title="Saved state and exact delivery evidence" hint="Newest 25 per category; not full history">
      <h3>Publication mappings</h3>{mapped.data.slice(0, 25).map((row) => <p key={row.publication_id}><code>{row.publication_id}</code> → {row.tab} · row <code>{row.row_id}</code> · next reserved revision {row.next_revision} · {row.enabled ? "enabled" : "paused"}</p>)}
      <h3>Future-publication policies</h3>{assigned.data.slice(0, 25).map((row) => <p key={row.binding_id}>Assignment <code>{row.binding_id}</code> · {row.enabled ? "enabled" : "paused"} · new-row checks {row.include_checks ? "enabled" : "off"}</p>)}
      <h3>Result events</h3>{observed.data.slice(0, 25).map((row) => <p key={`${row.event_kind}:${row.event_id}`}>{row.event_kind} <code>{row.event_id}</code> · {row.disposition} · intent <code>{row.outbox_id ?? "none"}</code></p>)}
      {[mapped.data.length, assigned.data.length, observed.data.length].some((length) => length > 25) && <p className="notice">Partial view: earlier records are not shown.</p>}
      <p>Queued is not delivered. Check exact outbox status. Revoked/unverified mapping owners cannot authorize new event writes. Pausing mappings does not cancel existing pending/leased intents. Revision conflicts stop delivery; reconcile pending writes before rebasing. These controls cannot detect Google connectivity or whether a local deliverer is running.</p>
    </Panel><Link href="/dashboard/settings/sheet-writeback">Review delivery queue</Link>
  </>;
}
