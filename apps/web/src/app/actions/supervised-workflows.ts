"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { workflowManifest } from "@/lib/supervised-workflows";
import type { FormState } from "./auth";

export async function enqueueSupervisedWorkflow(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const request = z.uuid().safeParse(form.get("requestId"));
  const raw = form.get("manifest");
  if (["requestId", "manifest", "confirmed"].some((key) => form.getAll(key).length !== 1) || !request.success || typeof raw !== "string" || raw.length > 5000 || form.get("confirmed") !== "on") {
    return { error: "Review and confirm one exact authorized workflow manifest. Credentials and identity documents belong only on the local device." };
  }
  let manifest: z.infer<typeof workflowManifest>;
  try { manifest = workflowManifest.parse(JSON.parse(raw)); }
  catch { return { error: "Invalid workflow manifest. Supply only the listed non-secret identity/target fields; use an approved revision for edits." }; }
  const destructive = manifest.operation === "post_delete" || manifest.operation === "account_block";
  if (destructive && (form.getAll("destructive").length !== 1 || form.get("destructive") !== "on")) return { error: "Explicitly confirm the exact destructive target." };
  try {
    const protocol = await db.rpc("reporting_supervised_workflow_version").abortSignal(AbortSignal.timeout(15000));
    if (protocol.error || protocol.data !== 1) return { error: "The reviewed supervised-workflow migration is not available. No task was queued." };
    const result = await db.rpc("reporting_enqueue_supervised_workflow", { org: organization.id, request_id: request.data, manifest, destructive_confirmed: destructive }).abortSignal(AbortSignal.timeout(15000));
    if (result.error || result.data !== request.data) return { error: "Queue outcome is unconfirmed or refused. Reconcile this request in history before retrying; verify the active session, exact assignment and approval. Do not change request IDs to bypass prior work." };
    revalidatePath("/dashboard/workflows"); revalidatePath("/dashboard/run");
    return { success: `Recorded request ${request.data}. The separate local runner must match the same reviewed manifest. Registration stops for human identity/location/OTP/consent steps; a queued task is not a completed action.` };
  } catch { return { error: "Workflow queue outcome is unconfirmed. Preserve this request ID and inspect history; never blindly repeat an account or content action." }; }
}
