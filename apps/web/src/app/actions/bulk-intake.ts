"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { stagedIntakeSchema } from "@/lib/bulk-intake";
import type { FormState } from "./auth";

export async function enqueueIntakeBatch(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const worker = z.uuid().safeParse(form.get("worker")), request = z.uuid().safeParse(form.get("request"));
  const raw = form.get("descriptors");
  if (!worker.success || !request.success || typeof raw !== "string" || raw.length > 100000) return { error: "Choose a helper and its redacted staged-intake descriptor." };
  let input;
  try { input = stagedIntakeSchema.parse(JSON.parse(raw)); } catch { return { error: "Use the redacted output from bulk_intake.py --stage, never cookie/proxy files or values." }; }
  if (Date.parse(input.expires_at) <= Date.now()) return { error: "Staged intake has expired. Review and prepare it again locally." };
  if (form.get("permitted") !== "on" || form.get("confirmed") !== "on") return { error: "Confirm necessity, permitted transfer/proxy use and these exact profile writes." };
  const records = input.rows.map(({ profile_id, kind, replace, path }) => ({ profile_id, kind, replace, path }));
  const queued = await db.rpc("reporting_enqueue_intake_batch", { org: organization.id, worker: worker.data, request_id: request.data, records, permitted: true });
  if (queued.error) return { error: "Queue not confirmed. Check setup, exact customer bindings and active session. Retry with the same request ID; do not create a new batch after an uncertain response." };
  revalidatePath("/dashboard/run");
  return { success: "Batch recorded (or identical receipt recovered). Each row still needs a valid lease, stopped exact profile and unexpired local ciphertext. A failure stops the batch; page visits never run it." };
}
