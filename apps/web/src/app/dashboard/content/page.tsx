import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { isMissingSchemaError } from "@/lib/checks";
import type { ContentDraft } from "@/lib/content";
import { formatTime } from "@/lib/time";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { PublishBatchForm } from "@/components/publish-batch-form";

export default async function Content() {
  const { db, organization } = await requireWorkspace(true);
  const result = await db.from("reporting_content_drafts").select("id,binding_id,content,status,revision,updated_at,approved_at").eq("organization_id", organization.id).order("updated_at", { ascending: false }).order("id").limit(101);
  if (result.error && !isMissingSchemaError(result.error)) throw new Error("Content drafts could not be loaded.");
  const drafts = (result.data ?? []).slice(0, 100) as ContentDraft[];
  const scheduling = await db.rpc("reporting_publish_scheduling_version");
  const approved = drafts.filter((draft) => draft.status === "approved");
  return <>
    <PageHeader eyebrow="PREPARE & REVIEW" title="Content & approvals" description="Prepare text posts and listings with revision-bound approval. Drafts are not published posts or browser jobs." actions={!result.error && <Link className="button" href="/dashboard/content/new">Create draft</Link>} />
    <div className="notice subtle"><strong>Approval alone never dispatches content</strong><p>Explicitly authorize approved revisions separately. A locally reviewed, authorized publisher is required; page views and approvals do not submit, schedule or mark content live. No platform acceptance is implied.</p></div>
    {result.error ? <Panel title="Content setup pending"><p>Your administrator needs to apply the reviewed content-draft migration. No content controls are enabled until setup is complete.</p></Panel> : <Panel title="Recent content" hint="Latest 100 drafts, including archived revisions">
      {(result.data?.length ?? 0) > 100 && <p className="notice">Partial list: only the latest 100 drafts are shown.</p>}
      {drafts.length ? <div className="table-wrap"><table><thead><tr><th>Content</th><th>Type</th><th>Review state</th><th>Revision</th><th>Updated</th></tr></thead><tbody>{drafts.map((draft) => <tr key={draft.id}><td><Link href={`/dashboard/content/${draft.id}`}>{draft.content.title}</Link></td><td>{draft.content.kind}</td><td>{draft.status === "approved" ? "Approved — not dispatched" : draft.status}</td><td>{draft.revision}</td><td>{formatTime(draft.updated_at, organization.time_zone)}</td></tr>)}</tbody></table></div> : <EmptyState title="No content drafts">Assign an authorized customer/profile in Automation control, then create and review content here. Nothing is imported or queued automatically.</EmptyState>}
    </Panel>}
    {!result.error && approved.length > 0 && <Panel title="Schedule or queue selected approved revisions" hint="Explicit authorization; original work session only">
      {!scheduling.error && scheduling.data === 1 ? <PublishBatchForm drafts={approved.map((draft) => ({ id: draft.id, revision: draft.revision, title: draft.content.title }))} timeZone={organization.time_zone} /> : <p>The reviewed scheduling migration is not available. These bulk/schedule controls stay disabled; existing draft preparation remains available.</p>}
    </Panel>}
  </>;
}
