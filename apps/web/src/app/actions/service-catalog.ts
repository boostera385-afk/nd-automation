"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/data";
import { serviceRulesSchema } from "@/lib/service-catalog-contract";
import type { FormState } from "./auth";

export async function stageServiceCatalog(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization, user } = await requireWorkspace(true, form);
  if (!user.email_confirmed_at) return { error: "Verify your email before staging service rules." };
  const input = z.object({ request: z.uuid(), expected: z.coerce.number().int().min(0).max(2147483646), confirmed: z.literal("on"), rules: z.string().min(2).max(262144) }).safeParse({ request: form.get("requestId"), expected: form.get("expectedRevision"), confirmed: form.get("confirmed"), rules: form.get("rules") });
  if (!input.success || new TextEncoder().encode(input.success ? input.data.rules : "").byteLength > 262144) return { error: "Review and confirm a valid bounded catalog before staging." };
  let value: unknown;
  try { value = JSON.parse(input.data.rules); } catch { return { error: "Catalog JSON is invalid. No save was requested." }; }
  const rules = serviceRulesSchema.safeParse(value);
  if (!rules.success) return { error: "Catalog rules failed validation. Resolve preview errors and field limits before staging." };
  try {
    const result = await db.rpc("reporting_save_service_catalog_v1", { org: organization.id, rules: rules.data, expected_revision: input.data.expected, request_id: input.data.request }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) {
      if (/Catalog (version|replay) conflict/.test(result.error.message)) return { error: "Catalog changed or this retry differs from its original request. Reload and review the saved revisions before trying again." };
      return { error: "Save was not confirmed. Retry this same form/request once, or reload and reconcile the revision list. Do not assume a timed-out save failed." };
    }
    const receipt = z.object({ revisionId: z.uuid(), revision: z.number().int().positive() }).strict().safeParse(result.data);
    if (!receipt.success || receipt.data.revision !== input.data.expected + 1) return { error: "Save receipt could not be verified. Reconcile saved revisions before another request." };
    revalidatePath("/dashboard/settings/services");
    return { success: `Staged revision ${receipt.data.revision}. Nothing was activated or applied to Fudge.` };
  } catch { return { error: "Save outcome is unconfirmed. Retry the same form or reconcile saved revisions; no automatic retry was started." }; }
}

export async function activateServiceCatalog(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization, user, membership } = await requireWorkspace(true, form);
  if (!user.email_confirmed_at || !["owner", "admin"].includes(membership.role)) return { error: "A verified owner or admin must review and activate this revision." };
  const input = z.object({ revision: z.uuid(), request: z.uuid(), expected: z.coerce.number().int().min(0).max(2147483646), confirmed: z.literal("on") }).safeParse({ revision: form.get("revisionId"), request: form.get("requestId"), expected: form.get("expectedVersion"), confirmed: form.get("confirmed") });
  if (!input.success) return { error: "Review the exact revision and confirm publication before continuing." };
  try {
    const result = await db.rpc("reporting_activate_service_catalog_v1", { org: organization.id, revision_id: input.data.revision, expected_version: input.data.expected, request_id: input.data.request }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) {
      if (/Activation (version|replay) conflict/.test(result.error.message)) return { error: "Published configuration changed. Reload the comparison and review it again; no automatic activation retry was started." };
      return { error: "Activation is unconfirmed. Retry this same request or reconcile the published generation before issuing another request." };
    }
    const receipt = z.object({ revisionId: z.uuid(), generation: z.number().int().positive() }).strict().safeParse(result.data);
    if (!receipt.success || receipt.data.revisionId !== input.data.revision || receipt.data.generation !== input.data.expected + 1) return { error: "Activation receipt could not be verified. Reconcile published configuration before another request." };
    revalidatePath("/dashboard/settings/services", "layout");
    return { success: `Published configuration generation ${receipt.data.generation}. Fudge download/application and intake upload gates remain separate; no collection or publishing job started.` };
  } catch { return { error: "Activation outcome is unconfirmed. Retry the same form or reconcile the published generation; do not assume it failed." }; }
}
