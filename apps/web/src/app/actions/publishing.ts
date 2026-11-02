"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import type { FormState } from "./auth";
import { publishBatchReceipt, scheduledEntries } from "@/lib/publish-scheduling";

// Queueing is a separate explicit authorization, never a side effect of approval.
// The default monitoring agent never submits; the opt-in publisher requires its
// own locally reviewed identity/composer adapter and runs at most one job.
export async function enqueueApprovedPublish(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const draft = z.uuid().safeParse(form.get("draft"));
  const revision = z.coerce.number().int().positive().max(2147483647).safeParse(form.get("expected_revision"));
  if (!draft.success || !revision.success || form.get("confirmed") !== "on") return { error: "Confirm the exact approved draft revision and its intended account before queuing." };
  const protocol = await db.rpc("reporting_publisher_protocol_version");
  if (protocol.error || protocol.data !== 1) return { error: "The supervised publisher safety migration is not available. No publishing job was queued." };
  const { error } = await db.rpc("reporting_enqueue_publish", { org: organization.id, draft: draft.data, expected_revision: revision.data });
  if (error) return { error: "Publishing was not queued. Check the current approval, unchanged account assignment, active work session and existing jobs. Never requeue submitted or ambiguous work." };
  revalidatePath(`/dashboard/content/${draft.data}`);
  revalidatePath("/dashboard/publishing");
  return { success: "Approved revision queued for supervised publishing. Nothing was submitted by this browser action. Use the reviewed one-job publisher, then verify its exact result in Publishing operations." };
}

/** Atomic explicit bulk authorization, never bulk approval or browser execution. */
export async function enqueueScheduledPublishBatch(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const request = z.uuid().safeParse(form.get("requestId"));
  const raw = form.get("entries");
  if (!request.success || form.get("confirmed") !== "on" || typeof raw !== "string" || raw.length > 32768) {
    return { error: "Review and explicitly confirm 1–20 approved revisions and their business-local dispatch windows." };
  }
  let entries: ReturnType<typeof scheduledEntries>;
  try { entries = scheduledEntries(JSON.parse(raw), organization.time_zone); }
  catch { return { error: "Invalid schedule. Use 1–20 distinct approved revisions, 5–30 minute windows, and an unambiguous business-local time within eight hours. Leave time empty for immediate dispatch." }; }
  try {
    const protocol = await db.rpc("reporting_publish_scheduling_version").abortSignal(AbortSignal.timeout(15000));
    if (protocol.error || protocol.data !== 1) return { error: "The reviewed scheduling migration is not available; no batch was queued." };
    const result = await db.rpc("reporting_enqueue_publish_batch", { org: organization.id, request_id: request.data, entries }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) return { error: "Batch outcome is unconfirmed or was refused. Reconcile the queue before retrying this same request. All revisions must remain approved and fit the original active session; never create new IDs to bypass duplicate protection." };
    const receipt = publishBatchReceipt.safeParse(result.data);
    if (!receipt.success || receipt.data.length !== entries.length || new Set(receipt.data.map((item) => item.jobId)).size !== entries.length ||
      receipt.data.some((item) => !entries.some((entry) => entry.draftId === item.draftId && entry.revision === item.revision &&
        (entry.notBefore === null || Date.parse(entry.notBefore) === Date.parse(item.notBefore)) &&
        Date.parse(item.dispatchUntil) - Date.parse(item.notBefore) === entry.windowMinutes * 60000)) ||
      new Set(receipt.data.map((item) => item.draftId)).size !== entries.length) {
      return { error: "Batch receipt could not be verified. Reconcile the recorded queue; do not issue a new request." };
    }
    for (const entry of entries) revalidatePath(`/dashboard/content/${entry.draftId}`);
    revalidatePath("/dashboard/content"); revalidatePath("/dashboard/publishing");
    return { success: `Recorded ${entries.length} exact approved revision(s). Nothing was submitted by this browser action. The separately authorized local publisher can claim only due work in the original session; missed dispatch windows are cancelled, not replayed next session.` };
  } catch { return { error: "Batch outcome is unconfirmed. Preserve this form's request ID and reconcile the queue before retrying; no browser action was started here." }; }
}

export async function cancelPendingPublish(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const job = z.uuid().safeParse(form.get("job"));
  if (!job.success || form.get("confirmed") !== "on") return { error: "Confirm cancellation of this pending job." };
  const { error } = await db.rpc("reporting_cancel_pending_publish", { org: organization.id, job: job.data });
  if (error) return { error: "Only a pending job can be cancelled. Refresh before trying again." };
  revalidatePath("/dashboard/publishing");
  return { success: "Pending publish job cancelled. No platform content was deleted." };
}

export async function reconcileExpiredPublish(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const job = z.uuid().safeParse(form.get("job"));
  if (!job.success || form.get("confirmed") !== "on") return { error: "Confirm that the old worker is stopped and the profile has been inspected." };
  const { error } = await db.rpc("reporting_reconcile_expired_publish", { org: organization.id, job: job.data });
  if (error) return { error: "Only an expired publish lease can be acknowledged. No retry was queued." };
  revalidatePath("/dashboard/publishing");
  return { success: "Expired operation marked Needs reconciliation, not failed or safe to retry. This draft remains blocked from re-posting." };
}
