"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { contentFromForm } from "@/lib/content";
import type { FormState } from "./auth";

const identity = z.object({ draft: z.uuid(), expected_revision: z.coerce.number().int().min(0), binding: z.uuid() });

export async function saveContentDraft(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true);
  const input = identity.safeParse({ draft: form.get("draft"), expected_revision: form.get("expected_revision"), binding: form.get("binding") });
  const content = contentFromForm(form);
  if (!input.success || !content.success) return { error: "Check the assigned profile, title, content, audience and listing fields. Price must be a nonnegative USD amount with at most two decimal places." };
  const { error } = await db.rpc("reporting_save_content_draft", { org: organization.id, ...input.data, value: content.data });
  if (error) return { error: "Draft was not saved. It may have changed in another tab, require return to draft, or use an unavailable assignment. Refresh before trying again." };
  revalidatePath("/dashboard/content");
  revalidatePath(`/dashboard/content/${input.data.draft}`);
  redirect(`/dashboard/content/${input.data.draft}`);
}

export async function reviewContentDraft(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true);
  const input = z.object({ draft: z.uuid(), expected_revision: z.coerce.number().int().positive(), decision: z.enum(["approve", "return", "archive"]) }).safeParse({ draft: form.get("draft"), expected_revision: form.get("expected_revision"), decision: form.get("decision") });
  if (!input.success || form.get("confirmed") !== "on") return { error: "Confirm your review of this exact revision and profile." };
  const { error } = await db.rpc("reporting_review_content_draft", { org: organization.id, ...input.data, confirmed: true });
  if (error) return { error: "Review was not saved. Refresh: the revision, assignment or approval state may have changed." };
  revalidatePath("/dashboard/content");
  revalidatePath(`/dashboard/content/${input.data.draft}`);
  return { success: "Review saved. No browser job was created and nothing was published." };
}
