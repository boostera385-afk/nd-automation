import Link from "next/link";
import { requireWorkspace } from "@/lib/data";
import { isMissingSchemaError } from "@/lib/checks";
import { formatTime } from "@/lib/time";
import { ActionForm } from "@/components/action-form";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { cancelPendingPublish, reconcileExpiredPublish } from "@/app/actions/publishing";

type Job = { id: string; draft_id: string; draft_revision: number; status: string; outcome: string | null; failure_notes: string | null; created_at: string; lease_expires_at: string | null; result_url: string | null };

export default async function Publishing() {
  const { db, organization } = await requireWorkspace(true);
  const result = await db.from("reporting_publish_jobs").select("id,draft_id,draft_revision,status,outcome,failure_notes,created_at,lease_expires_at,result_url").eq("organization_id", organization.id).order("created_at", { ascending: false }).order("id").limit(101);
  if (result.error && !isMissingSchemaError(result.error)) throw new Error("Publishing records could not be loaded. No jobs were changed.");
  const jobs = (result.data ?? []).slice(0, 100) as Job[];
  return <>
    <PageHeader eyebrow="PUBLISHING PROTOCOL" title="Publishing operations" description="Inspect durable publishing-job records. Browser submission and the dashboard release button are not enabled." actions={<Link className="button secondary" href="/dashboard/content">Prepare content</Link>} />
    <div className="notice subtle"><strong>No live publisher is connected</strong><p>The bundled local agent accepts monitoring only. Publish jobs are an implementation-stage protocol; preparing or approving content never submits it. Attachments, schedules and a validated exact-result browser adapter remain pending.</p></div>
    {result.error ? <Panel title="Publish protocol setup pending"><p>The publishing-protocol migration has not been applied here. Drafts and monitoring remain separate and continue to work. No publishing controls are enabled.</p></Panel> : <Panel title="Latest publishing jobs" hint="Latest 100 records; no automatic retries">
      {(result.data?.length ?? 0) > 100 && <p className="notice">Partial list: earlier jobs are not shown.</p>}
      {jobs.length ? jobs.map((job) => <article key={job.id} className="notice subtle"><h3><Link href={`/dashboard/content/${job.draft_id}`}>Draft revision {job.draft_revision}</Link> · {job.status}</h3><p>Queued: {formatTime(job.created_at, organization.time_zone)} · {job.outcome ?? "No result yet"}</p>{job.failure_notes && <p>{job.failure_notes}</p>}{job.result_url && <p>Recorded result URL: <code>{job.result_url}</code>. Submission is not a live-visibility check.</p>}
        {job.status === "pending" && <ActionForm action={cancelPendingPublish} label="Cancel pending job" secondary><input type="hidden" name="job" value={job.id} /><label className="check-label"><input type="checkbox" name="confirmed" required />Cancel this unclaimed job; this does not delete any post.</label></ActionForm>}
        {job.status === "leased" && <><p>Lease deadline: {job.lease_expires_at ? formatTime(job.lease_expires_at, organization.time_zone) : "Unknown"}</p><ActionForm action={reconcileExpiredPublish} label="Acknowledge expired operation" secondary><input type="hidden" name="job" value={job.id} /><label className="check-label"><input type="checkbox" name="confirmed" required />The old worker is stopped and I inspected this profile. Mark ambiguity for manual review; do not authorize a retry. Only expired leases can be acknowledged.</label></ActionForm></>}
      </article>) : <EmptyState title="No publishing jobs">Prepare and review content separately. There is no release-to-browser action until the publisher’s safety gates are validated.</EmptyState>}
    </Panel>}
  </>;
}
