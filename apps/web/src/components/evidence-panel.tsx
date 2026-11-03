import { requireWorkspace } from "@/lib/data";
import { Panel } from "./ui";
import { ActionForm } from "./action-form";
import { EvidenceUpload } from "./evidence-upload";
import { manageEvidence } from "@/app/actions/evidence";
import { formatTime } from "@/lib/time";

export async function EvidencePanel({ publication }: { publication: string }) {
  const { db, organization, isStaff } = await requireWorkspace();
  const records = await db.from("reporting_evidence").select("id,state,held,observed_at,review_after,sha256").eq("organization_id", organization.id).eq("publication_id", publication).order("created_at", { ascending: false }).limit(101);
  return <Panel title="Private evidence"><p>Evidence is a supplied image, not a new platform observation. No automatic deletion is enabled. Downloads recheck current account/customer access; downloaded copies cannot be revoked.</p>
    {records.error ? <p>Evidence storage is not configured or unavailable. No files were changed.</p> : <>
      {(records.data ?? []).slice(0, 100).map((item) => <article key={item.id}><p><strong>{item.state}</strong>{item.held && " · On preservation hold"} · Observed {formatTime(item.observed_at, organization.time_zone)}{item.review_after && ` · Review after ${formatTime(item.review_after, organization.time_zone)}`}</p>
        <small>SHA-256: {item.sha256}</small>{item.state !== "deleted" && <p><a href={`/dashboard/evidence/${item.id}`}>Download exact evidence</a></p>}
        {isStaff && item.state !== "deleted" && <ActionForm action={manageEvidence} label="Apply confirmed evidence action" secondary>
          <input type="hidden" name="evidence" value={item.id} /><label>Action<select name="operation" required defaultValue=""><option value="" disabled>Choose explicitly</option>{item.state === "pending" && <option value="ready">Finalize pending upload</option>}{["pending", "ready"].includes(item.state) && <><option value="hold">Place preservation hold</option><option value="release">Release hold (administrator)</option></>}<option value="request_delete">Permanently delete this exact evidence / retry deletion</option></select></label>
          <label className="check"><input name="confirmed" type="checkbox" required />I reviewed this exact evidence and authorize this action. Deletion removes the object permanently and keeps a metadata tombstone.</label>
        </ActionForm>}
      </article>)}{(records.data?.length ?? 0) > 100 && <p>Showing newest 100 records; older evidence is not deleted.</p>}
      {isStaff && <details><summary>Add operator-reviewed evidence</summary><EvidenceUpload publication={publication} /></details>}
    </>}
  </Panel>;
}
