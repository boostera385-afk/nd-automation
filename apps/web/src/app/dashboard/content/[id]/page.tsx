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

type Revision = { revision: number; event: string; content: ContentDraft["content"]; target: { customer_id: string; profile_id: string; account_label: string; worker_id: string }; actor_id: string | null; created_at: string };

export default async function ContentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, organization } = await requireWorkspace(true);
  const [result, history, assignments] = await Promise.all([
    db.from("reporting_content_drafts").select("id,binding_id,content,status,revision,updated_at,approved_at").eq("organization_id", organization.id).eq("id", id).maybeSingle(),
    db.from("reporting_content_revisions").select("revision,event,content,target,actor_id,created_at").eq("organization_id", organization.id).eq("draft_id", id).order("revision", { ascending: false }).limit(101),
    getContentTargets(),
  ]);
  if (result.error || history.error) throw new Error("Content or revision history could not be loaded.");
  if (!result.data) notFound();
  const draft = result.data as ContentDraft;
  const revisions = (history.data ?? []).slice(0, 100) as Revision[];
  const latest = revisions[0];
  const currentTarget = assignments.targets.find((target) => target.id === draft.binding_id);
  const targetChanged = !currentTarget || !latest || latest.target.profile_id !== currentTarget.profile_id || latest.target.customer_id !== currentTarget.customer_id || latest.target.account_label !== currentTarget.account_label || latest.target.worker_id !== currentTarget.worker_id;
  return <>
    <PageHeader eyebrow="PREPARE & REVIEW" title={draft.content.title} description={`Revision ${draft.revision} · ${draft.status === "approved" ? "Approved — not dispatched" : draft.status} · No browser submission`} actions={<Link className="button secondary" href="/dashboard/content">All content</Link>} />
    <Panel title="Saved revision preview"><p>Customer UUID: <code>{latest?.target.customer_id ?? "Unavailable"}</code></p><p>{latest?.target.account_label} · Profile UUID: <code>{latest?.target.profile_id ?? "Unavailable"}</code></p><p>Intended audience: <strong>{audiences[draft.content.audience]}</strong></p>{draft.content.kind === "listing" && <p>Requested category: {draft.content.category} · USD {(draft.content.price_cents / 100).toFixed(2)}</p>}<div className="content-body">{draft.content.body}</div><p className="muted small">No attachments. Requested categories and audiences have not been verified against the live platform.</p></Panel>
    {targetChanged && <p className="notice">The assignment is unavailable or changed since the saved snapshot. Save a new draft revision against the intended enabled worker/profile before approval. Existing approvals do not authorize dispatch.</p>}
    {draft.status === "draft" && <Panel title="Edit draft" hint="Saving creates a new immutable revision">{assignments.limited && <p className="notice">Assignment choices are partial (500 per source).</p>}<ContentComposer key={draft.revision} id={id} draft={draft} targets={assignments.targets} /></Panel>}
    {draft.status !== "archived" && <Panel title="Human review" hint="Review changes do not enqueue any work">
      {draft.status === "draft" && !targetChanged && <ActionForm key={`approve-${draft.revision}`} action={reviewContentDraft} label="Approve this revision — do not publish"><input type="hidden" name="draft" value={id} /><input type="hidden" name="expected_revision" value={draft.revision} /><input type="hidden" name="decision" value="approve" /><label className="check-label"><input type="checkbox" name="confirmed" required />I reviewed the exact customer/profile, text, audience and listing fields and have customer authorization. This approval is preparation only.</label></ActionForm>}
      {draft.status === "approved" && <ActionForm key={`return-${draft.revision}`} action={reviewContentDraft} label="Return to draft" secondary><input type="hidden" name="draft" value={id} /><input type="hidden" name="expected_revision" value={draft.revision} /><input type="hidden" name="decision" value="return" /><label className="check-label"><input type="checkbox" name="confirmed" required />Remove current approval before editing. History is retained.</label></ActionForm>}
      <ActionForm key={`archive-${draft.revision}`} action={reviewContentDraft} label="Archive draft" secondary><input type="hidden" name="draft" value={id} /><input type="hidden" name="expected_revision" value={draft.revision} /><input type="hidden" name="decision" value="archive" /><label className="check-label"><input type="checkbox" name="confirmed" required />Archive this content, retaining history. This does not delete any platform post. Archived drafts cannot be edited.</label></ActionForm>
    </Panel>}
    <Panel title="Revision history" hint="Latest 100 entries; staff only">{(history.data?.length ?? 0) > 100 && <p className="notice">Earlier revisions are not included in this view.</p>}{revisions.map((revision) => <details key={revision.revision} className="notice subtle"><summary>Revision {revision.revision} · {revision.event} · {formatTime(revision.created_at, organization.time_zone)}</summary><p>Actor: <code>{revision.actor_id ?? "Deleted user"}</code></p><p>{revision.target.account_label} · <code>{revision.target.profile_id}</code> · Worker <code>{revision.target.worker_id}</code></p><h3>{revision.content.title}</h3><p>{revision.content.kind} · {audiences[revision.content.audience]}{revision.content.kind === "listing" && ` · ${revision.content.category} · USD ${(revision.content.price_cents / 100).toFixed(2)}`}</p><div className="content-body">{revision.content.body}</div></details>)}</Panel>
  </>;
}
