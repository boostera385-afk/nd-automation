"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { EVIDENCE_BUCKET, MAX_EVIDENCE_BYTES, evidenceRequest, inspectEvidence } from "@/lib/evidence";
import type { FormState } from "./auth";

export async function uploadEvidence(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const input = evidenceRequest.safeParse({ publication: form.get("publication"), observed: form.get("observed"), reviewDays: form.get("reviewDays") ?? "" });
  const file = form.get("file");
  if (!input.success || !(file instanceof File) || !file.size || file.size > MAX_EVIDENCE_BYTES) return { error: "Choose an exact publication, zoned observation time and PNG/JPEG up to 3 MiB." };
  if (form.get("reviewed") !== "on") return { error: "Review rights, personal data and image metadata before uploading." };
  let descriptor;
  try { descriptor = inspectEvidence(Buffer.from(await file.arrayBuffer()), file.type); }
  catch { return { error: "Image bytes/type/dimensions could not be verified. No upload was reserved." }; }
  const reserved = await db.rpc("reporting_reserve_evidence", { org: organization.id, publication: input.data.publication,
    content_mime: descriptor.mime, content_bytes: descriptor.bytes, content_sha256: descriptor.sha256,
    observed: input.data.observed, review_days: input.data.reviewDays === "" ? null : input.data.reviewDays });
  if (reserved.error || !z.uuid().safeParse(reserved.data).success) return { error: "Evidence reservation failed. Check database/storage setup and access." };
  const id = String(reserved.data), key = `${organization.id}/${id}`;
  const uploaded = await db.storage.from(EVIDENCE_BUCKET).upload(key, file, { contentType: descriptor.mime, upsert: false, cacheControl: "0" });
  revalidatePath(`/dashboard/posts/${input.data.publication}`);
  if (uploaded.error) return { error: "Upload was not confirmed. A pending reservation remains; review it before retrying. No post status changed." };
  const ready = await db.rpc("reporting_evidence_action", { org: organization.id, evidence: id, action: "ready" });
  if (ready.error) return { error: "Object uploaded but finalization was not confirmed. Use Finalize pending upload after reviewing it; do not upload a duplicate." };
  return { success: "Evidence saved privately. Observation time is operator supplied; this does not establish post visibility." };
}

export async function manageEvidence(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const id = z.uuid().safeParse(form.get("evidence"));
  const action = z.enum(["hold", "release", "ready", "request_delete"]).safeParse(form.get("operation"));
  if (!id.success || !action.success || form.get("confirmed") !== "on") return { error: "Confirm the exact evidence action." };
  const record = await db.from("reporting_evidence").select("id,publication_id,object_key").eq("organization_id", organization.id).eq("id", id.data).single();
  if (record.error || !record.data || record.data.object_key !== `${organization.id}/${id.data}`) return { error: "Evidence not available in this workspace." };
  const changed = await db.rpc("reporting_evidence_action", { org: organization.id, evidence: id.data, action: action.data });
  if (changed.error) return { error: "Action denied or state changed. Held evidence cannot be deleted; only administrators release holds." };
  if (action.data === "request_delete") {
    const removed = await db.storage.from(EVIDENCE_BUCKET).remove([record.data.object_key]);
    if (removed.error) return { error: "Deletion authorized but object removal not confirmed. Retry this exact deletion; the tombstone remains." };
    const finished = await db.rpc("reporting_evidence_action", { org: organization.id, evidence: id.data, action: "finish_delete" });
    if (finished.error) return { error: "Object removal requested; finalization requires reconciliation. Retry this exact deletion, not a new upload." };
  }
  revalidatePath(`/dashboard/posts/${record.data.publication_id}`);
  return { success: "Evidence action recorded. No publication status was changed." };
}
