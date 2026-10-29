"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { publicConfig } from "@/lib/env";
import type { FormState } from "./auth";

export type WorkerRegistrationState = FormState & { connection?: string };
const refresh = () => revalidatePath("/dashboard", "layout");

export async function registerWorker(_previous: WorkerRegistrationState, form: FormData): Promise<WorkerRegistrationState> {
  const { db, organization } = await requireWorkspace(true, form);
  const name = z.string().trim().min(2).max(100).safeParse(form.get("name"));
  const config = publicConfig();
  if (!name.success || !config) return { error: "Enter a worker name of 2–100 characters." };
  if (!config.key.startsWith("sb_publishable_")) return { error: "Configure a modern Supabase publishable key before registering a worker. Never use a service-role key." };
  if (form.get("authorized") !== "on") return { error: "Confirm this is your authorized worker machine." };
  const token = randomBytes(32).toString("hex");
  const { error } = await db.rpc("reporting_register_worker", { org: organization.id, worker_name: name.data, credential_hash: createHash("sha256").update(token).digest("hex") });
  if (error) return { error: "Worker could not be registered. Check access and the worker migration." };
  refresh();
  return { success: "Worker registered. Save this credential privately now; it cannot be retrieved later.", connection: JSON.stringify({ version: 1, supabase_url: config.url, publishable_key: config.key, worker_token: token }, null, 2) };
}

export async function bindWorkerProfile(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const input = z.object({ worker: z.uuid(), customer: z.uuid(), profile: z.uuid(), label: z.string().trim().min(1).max(120) }).safeParse(Object.fromEntries(["worker", "customer", "profile", "label"].map((key) => [key, form.get(key)])));
  if (!input.success) return { error: "Choose a worker/customer and enter the exact profile UUID and account label." };
  if (form.get("authorized") !== "on") return { error: "Confirm the customer authorized this exact profile." };
  const { error } = await db.rpc("reporting_bind_worker_profile", { org: organization.id, ...input.data });
  if (error) return { error: "Profile could not be assigned. Check the UUID, customer, worker or existing assignment." };
  refresh();
  return { success: "Profile assigned. Monitoring remains off until you explicitly enable it for a work session." };
}

export async function setProfileMonitoring(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const id = z.uuid().safeParse(form.get("binding"));
  const enabled = form.get("enabled") === "true";
  if (!id.success || (enabled && form.get("authorized") !== "on")) return { error: "Confirm authorized read-only monitoring for this assigned profile." };
  const { error } = await db.rpc("reporting_set_profile_monitoring", { org: organization.id, binding: id.data, enabled });
  if (error) return { error: "Monitoring could not be changed. Start an active work session first and check the assignment." };
  refresh();
  return { success: enabled ? "Monitoring enabled for this work session only. Due posts wait for your connected local agent." : "Automatic planning disabled and pending checks for this assignment cancelled. An in-flight read may finish." };
}

export async function revokeWorker(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const worker = z.uuid().safeParse(form.get("worker"));
  if (!worker.success || form.get("confirmed") !== "on") return { error: "Confirm revocation of this worker credential." };
  const { error } = await db.rpc("reporting_revoke_worker", { org: organization.id, worker: worker.data });
  if (error) return { error: "Worker could not be revoked." };
  refresh();
  return { success: "Credential revoked and pending jobs cancelled. An in-flight local read may finish, but future submissions are denied." };
}

export async function cancelPendingCheck(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const job = z.uuid().safeParse(form.get("job"));
  if (!job.success) return { error: "Invalid job." };
  const { error } = await db.rpc("reporting_cancel_pending_check", { org: organization.id, job: job.data });
  if (error) return { error: "Only a pending job can be cancelled here. Refresh to see its current state." };
  refresh();
  return { success: "Pending check cancelled." };
}

export async function reconcileExpiredCheck(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const job = z.uuid().safeParse(form.get("job"));
  if (!job.success || form.get("reconciled") !== "on") return { error: "Confirm that the old agent is stopped, the profile is closed, and partial results have been reconciled." };
  const { error } = await db.rpc("reporting_reconcile_expired_check", { org: organization.id, job: job.data });
  if (error) return { error: "Only an expired lease can be reconciled. No new check has been started." };
  refresh();
  return { success: "Expired lease cancelled after your confirmation. A new due check can be planned by the connected worker." };
}

export async function reassignWorkerProfile(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const input = z.object({ binding: z.uuid(), replacement: z.uuid() }).safeParse({ binding: form.get("binding"), replacement: form.get("replacement") });
  if (!input.success || form.get("confirmed") !== "on") return { error: "Choose a replacement and confirm the old agent is stopped and its profile closed." };
  const { error } = await db.rpc("reporting_reassign_worker_profile", { org: organization.id, ...input.data });
  if (error) return { error: "Reassignment failed. Revoke the old worker and reconcile outstanding leases first; choose an enabled worker in this workspace." };
  refresh();
  return { success: "Assignment moved to the replacement worker. Monitoring is off until authorized again." };
}
