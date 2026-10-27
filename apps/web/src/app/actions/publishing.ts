"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import type { FormState } from "./auth";

// No enqueue action is exposed until the worker's submit/evidence adapter passes
// supervised acceptance. These controls only manage pre-existing protocol jobs.
export async function cancelPendingPublish(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true);
  const job = z.uuid().safeParse(form.get("job"));
  if (!job.success || form.get("confirmed") !== "on") return { error: "Confirm cancellation of this pending job." };
  const { error } = await db.rpc("reporting_cancel_pending_publish", { org: organization.id, job: job.data });
  if (error) return { error: "Only a pending job can be cancelled. Refresh before trying again." };
  revalidatePath("/dashboard/publishing");
  return { success: "Pending publish job cancelled. No platform content was deleted." };
}

export async function reconcileExpiredPublish(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true);
  const job = z.uuid().safeParse(form.get("job"));
  if (!job.success || form.get("confirmed") !== "on") return { error: "Confirm that the old worker is stopped and the profile has been inspected." };
  const { error } = await db.rpc("reporting_reconcile_expired_publish", { org: organization.id, job: job.data });
  if (error) return { error: "Only an expired publish lease can be acknowledged. No retry was queued." };
  revalidatePath("/dashboard/publishing");
  return { success: "Expired operation marked Needs reconciliation, not failed or safe to retry. This draft remains blocked from re-posting." };
}
