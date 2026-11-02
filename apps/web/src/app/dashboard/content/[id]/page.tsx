import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { getContentTargets } from "@/lib/content-data";
import { audiences, type ContentDraft } from "@/lib/content";
import { formatTime } from "@/lib/time";
import { ContentComposer } from "@/components/content-composer";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/ui";
import { reviewContentDraft } from "@/app/actions/content";
import { enqueueApprovedPublish } from "@/app/actions/publishing";

type Revision = { revision: number; event: string; content: ContentDraft["content"]; target: { customer_id: string; profile_id: string; account_label: string; worker_id: string }; actor_id: string | null; created_at: string };

export default async function ContentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, organization } = await requireWorkspace(true);
  const [result, history, assignments, protocol] = await Promise.all([
    db.from("reporting_content_drafts").select("id,binding_id,content,status,revision,updated_at,approved_at").eq("organization_id", organization.id).eq("id", id).maybeSingle(),
    db.from("reporting_content_revisions").select("revision,event,content,target,actor_id,created_at").eq("organization_id", organization.id).eq("draft_id", id).order("revision", { ascending: false }).limit(101),
    getContentTargets(),
    db.rpc("reporting_publisher_protocol_version"),
  ]);
  if (result.error || history.error) throw new Error("Content or revision history could not be loaded.");
  if (!result.data) notFound();
  const draft = result.data as ContentDraft;
  const revisions = (history.data ?? []).slice(0, 100) as Revision[];
  const latest = revisions[0];
  const currentTarget = assignments.targets.find((target) => target.id === draft.binding_id);
  const targetChanged = !currentTarget || !latest || latest.target.profile_id !== currentTarget.profile_id || latest.target.customer_id !== currentTarget.customer_id || latest.target.account_label !== currentTarget.account_label || latest.target.worker_id !== currentTarget.worker_id;
  return <>
    <PageHeader eyebrow="PREPARE & REVIEW" title={draft.content.title} description={`Revision ${draft.revision} · ${draft.status === "approved" ? "Approved — see Publishing for dispatch status" : draft.status} · Opening this page submits nothing`} actions={<Link className="button secondary" href="/dashboard/content">All content</Link>} />
    <Panel title="Saved revision preview"><p>Customer UUID: <code>{latest?.target.customer_id ?? "Unavailable"}</code></p><p>{latest?.target.account_label} · Profile UUID: <code>{latest?.target.profile_id ?? "Unavailable"}</code></p><p>Intended audience: <strong>{audiences[draft.content.audience]}</strong></p>{draft.content.kind === "listing" && <p>Requested category: {draft.content.category} · USD {(draft.content.price_cents / 100).toFixed(2)}</p>}<div className="content-body">{draft.content.body}</div>{draft.content.media?.length ? <><p>{draft.content.media.length} approved local image descriptor(s), in this order. Inspect the actual matching originals on the authorized device; metadata is not a visual preview.</p><ol>{draft.content.media.map((item) => <li key={item.id}><code>{item.name}</code> · {item.mime} · {item.bytes} bytes · SHA-256 <code>{item.sha256}</code> · rights/privacy attested</li>)}</ol></> : <p>No attachments.</p>}<p className="muted small">Requested categories and audiences have not been verified against the live platform.</p></Panel>
    {targetChanged && <p className="notice">The assignment is unavailable or changed since the saved snapshot. Save a new draft revision against the intended enabled worker/profile before approval. Existing approvals do not authorize dispatch.</p>}
    {draft.status === "draft" && <Panel title="Edit draft" hint="Saving creates a new immutable revision">{assignments.limited && <p className="notice">Assignment choices are partial (500 per source).</p>}<ContentComposer key={draft.revision} id={id} draft={draft} targets={assignments.targets} /></Panel>}
    {draft.status !== "archived" && <Panel title="Human review" hint="Review changes do not enqueue any work">
      {draft.status === "draft" && !targetChanged && <ActionForm key={`approve-${draft.revision}`} action={reviewContentDraft} label="Approve this revision — do not publish"><input type="hidden" name="draft" value={id} /><input type="hidden" name="expected_revision" value={draft.revision} /><input type="hidden" name="decision" value="approve" /><label className="check-label"><input type="checkbox" name="confirmed" required />I reviewed the exact customer/profile, text, audience and listing fields and have customer authorization. This approval is preparation only.</label></ActionForm>}
      {draft.status === "approved" && <ActionForm key={`return-${draft.revision}`} action={reviewContentDraft} label="Return to draft" secondary><input type="hidden" name="draft" value={id} /><input type="hidden" name="expected_revision" value={draft.revision} /><input type="hidden" name="decision" value="return" /><label className="check-label"><input type="checkbox" name="confirmed" required />Remove current approval before editing. History is retained.</label></ActionForm>}
      <ActionForm key={`archive-${draft.revision}`} action={reviewContentDraft} label="Archive draft" secondary><input type="hidden" name="draft" value={id} /><input type="hidden" name="expected_revision" value={draft.revision} /><input type="hidden" name="decision" value="archive" /><label className="check-label"><input type="checkbox" name="confirmed" required />Archive this content, retaining history. This does not delete any platform post. Archived drafts cannot be edited.</label></ActionForm>
    </Panel>}
    {draft.status === "approved" && !targetChanged && <Panel title="Supervised text publishing" hint="Separate from approval; no unattended or media publishing">
       <p>A locally reviewed publisher must verify the exact account, content, approved images and audience. It attempts Submit at most once; uncertain results require reconciliation, never a blind retry. Image execution requires the new media-capable claimant, private local registry and reviewed attachment controls; it never silently falls back to text-only. Live browser acceptance remains pending. Session-bounded scheduling and selected-revision authorization are available from Content when the reviewed scheduling migration is installed.</p>
      {!protocol.error && protocol.data === 1 ? <ActionForm key={`publish-${draft.revision}`} action={enqueueApprovedPublish} label="Queue approved revision for supervised publishing"><input type="hidden" name="draft" value={id} /><input type="hidden" name="expected_revision" value={draft.revision} /><label className="check-label"><input type="checkbox" name="confirmed" required />I authorize this exact approved revision for its saved customer, account, profile and audience in my active work session. I have permission to publish this content and will supervise the one-job publisher.</label></ActionForm> : <p className="notice">The supervised publisher safety migration is not available. Publishing cannot be queued here.</p>}
      <p><Link href="/dashboard/publishing">Review publishing jobs and reconciliation</Link></p>
    </Panel>}
    <Panel title="Revision history" hint="Latest 100 entries; staff only">{(history.data?.length ?? 0) > 100 && <p className="notice">Earlier revisions are not included in this view.</p>}{revisions.map((revision) => <details key={revision.revision} className="notice subtle"><summary>Revision {revision.revision} · {revision.event} · {formatTime(revision.created_at, organization.time_zone)}</summary><p>Actor: <code>{revision.actor_id ?? "Deleted user"}</code></p><p>{revision.target.account_label} · <code>{revision.target.profile_id}</code> · Worker <code>{revision.target.worker_id}</code></p><h3>{revision.content.title}</h3><p>{revision.content.kind} · {audiences[revision.content.audience]}{revision.content.kind === "listing" && ` · ${revision.content.category} · USD ${(revision.content.price_cents / 100).toFixed(2)}`}</p><div className="content-body">{revision.content.body}</div></details>)}</Panel>
  </>;
}
