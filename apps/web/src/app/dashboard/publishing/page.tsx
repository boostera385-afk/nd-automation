import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { isMissingSchemaError } from "@/lib/checks";
import { formatTime } from "@/lib/time";
import { ActionForm } from "@/components/action-form";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { cancelPendingPublish, reconcileExpiredPublish } from "@/app/actions/publishing";
import { z } from "zod";

const jobShape = z.strictObject({ id: z.uuid(), draft_id: z.uuid(), draft_revision: z.number().int().positive(),
  status: z.enum(["pending", "leased", "completed", "cancelled"]), outcome: z.string().nullable(), failure_notes: z.string().max(2000).nullable(),
  created_at: z.iso.datetime({ offset: true }), lease_expires_at: z.iso.datetime({ offset: true }).nullable(), result_url: z.string().max(2048).nullable(),
  not_before: z.iso.datetime({ offset: true }).optional(), dispatch_until: z.iso.datetime({ offset: true }).nullable().optional() });

export default async function Publishing() {
  const { db, organization } = await requireWorkspace(true);
  const scheduling = await db.rpc("reporting_publish_scheduling_version");
  const hasScheduling = !scheduling.error && scheduling.data === 1;
  const fields = "id,draft_id,draft_revision,status,outcome,failure_notes,created_at,lease_expires_at,result_url" + (hasScheduling ? ",not_before,dispatch_until" : "");
  const result = await db.from("reporting_publish_jobs").select(fields).eq("organization_id", organization.id).order("created_at", { ascending: false }).order("id").limit(101);
  if (result.error && !isMissingSchemaError(result.error)) throw new Error("Publishing records could not be loaded. No jobs were changed.");
  const parsed = z.array(jobShape).max(101).safeParse(result.data ?? []);
  if (!parsed.success) throw new Error("Publishing records were malformed. No jobs were changed.");
  const jobs = parsed.data.slice(0, 100);
  return <>
    <PageHeader eyebrow="SUPERVISED PUBLISHING" title="Publishing operations" description="Review approved-revision jobs and exact submission receipts. Submission is not a visibility check." actions={<Link className="button secondary" href="/dashboard/content">Prepare content</Link>} />
    <div className="notice subtle"><strong>Publishing requires explicit authorization</strong><p>Preparing or approving content never submits it. Authorize exact approved revisions separately, then run the opt-in publisher with its locally reviewed account/composer adapter. One-job execution is the default; bounded sequential runs/watching require separate local confirmation. Schedules remain in the original active work session, and missed windows never catch up. The normal monitoring agent does not publish. Attachments and live platform acceptance remain separate gates. Uncertain submissions are never automatically retried.</p></div>
    {result.error ? <Panel title="Publish protocol setup pending"><p>The publishing-protocol migration has not been applied here. Drafts and monitoring remain separate and continue to work. No publishing controls are enabled.</p></Panel> : <Panel title="Latest publishing jobs" hint="Latest 100 records; no automatic retries">
      {(result.data?.length ?? 0) > 100 && <p className="notice">Partial list: earlier jobs are not shown.</p>}
      {jobs.length ? jobs.map((job) => <article key={job.id} className="notice subtle"><h3><Link href={`/dashboard/content/${job.draft_id}`}>Draft revision {job.draft_revision}</Link> · {job.status}</h3><p>Queued: {formatTime(job.created_at, organization.time_zone)} · {job.outcome ?? "No result yet"}</p>{job.not_before && <p>Not before: {formatTime(job.not_before, organization.time_zone)} · Claim deadline: {job.dispatch_until ? formatTime(job.dispatch_until, organization.time_zone) : "Original active session only"}</p>}{job.failure_notes && <p>{job.failure_notes}</p>}{job.result_url && <p>Recorded result URL: <code>{job.result_url}</code>. Submission is not a live-visibility check.</p>}
        {job.status === "pending" && <ActionForm action={cancelPendingPublish} label="Cancel pending job" secondary><input type="hidden" name="job" value={job.id} /><label className="check-label"><input type="checkbox" name="confirmed" required />Cancel this unclaimed job; this does not delete any post.</label></ActionForm>}
        {job.status === "leased" && <><p>Lease deadline: {job.lease_expires_at ? formatTime(job.lease_expires_at, organization.time_zone) : "Unknown"}</p><ActionForm action={reconcileExpiredPublish} label="Acknowledge expired operation" secondary><input type="hidden" name="job" value={job.id} /><label className="check-label"><input type="checkbox" name="confirmed" required />The old worker is stopped and I inspected this profile. Mark ambiguity for manual review; do not authorize a retry. Only expired leases can be acknowledged.</label></ActionForm></>}
      </article>) : <EmptyState title="No publishing jobs">Prepare and approve content, then explicitly queue that exact revision from its detail page. A reviewed local publisher and a supervised live test are still required before client use.</EmptyState>}
    </Panel>}
  </>;
}
