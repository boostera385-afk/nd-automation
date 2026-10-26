"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/data";
import { checkOutcomeSchema, checkOutcomes, isMissingSchemaError } from "@/lib/checks";
import { uuid } from "@/lib/validation";
import type { FormState } from "./auth";

export type CheckState = FormState & { nonce?: number };

// Records what a person found when they opened the post(s): one atomic call for one post or up to 100.
// A check that could not be completed (proxy, login, ...) is stored as exactly that, never as a removal.
export async function recordChecks(_previous: CheckState, form: FormData): Promise<CheckState> {
  const { db, organization } = await requireWorkspace(true);
  const input = z.object({
    ids: z.array(uuid).min(1, "Select at least one post.").max(100, "Select up to 100 posts at a time."),
    outcome: checkOutcomeSchema,
    notes: z.string().trim().max(2000, "Notes can be up to 2,000 characters."),
    comments: z.number().int().min(0).max(10_000_000).nullable(),
  }).safeParse({
    ids: [...new Set(form.getAll("publication_ids").map(String))],
    outcome: form.get("outcome"),
    notes: String(form.get("notes") ?? ""),
    comments: form.get("comments_total") ? Number(form.get("comments_total")) : null,
  });
  if (!input.success) return { error: input.error.issues[0].message };
  if (form.get("reviewed") !== "on") return { error: "Confirm you opened each selected post in an authorized view." };
  const { ids, outcome, notes, comments } = input.data;
  if (outcome === "deleted_from_nd" && notes.length < 10) return { error: "Describe the removal message you saw (at least 10 characters). A post that merely would not load is not proof of removal." };

  const checks = ids.map((id) => ({ publication_id: id, outcome, ...(ids.length === 1 && comments !== null ? { comments_total: comments } : {}) }));
  const { error } = await db.rpc("reporting_record_checks", { org: organization.id, checks, review_notes: notes });
  if (isMissingSchemaError(error)) return { error: "Post checks need a one-time database update. Ask your administrator to apply the latest migration." };
  if (error) return { error: "The checks could not be saved, and nothing was partly recorded. Refresh and try again." };

  revalidatePath("/dashboard", "layout");
  const count = ids.length;
  return { success: `${count} ${count === 1 ? "check" : "checks"} recorded: ${checkOutcomes[outcome].headline}. Your team has been notified.`, nonce: Date.now() };
}
