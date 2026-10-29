"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/data";
import { isMissingSchemaError } from "@/lib/checks";
import { cohortDaySchema, cohortKindSchema, cohortReceiptSchema, type CohortReceipt } from "@/lib/check-cohort";

export type CohortState = { error?: string; receipt?: CohortReceipt };

export async function refreshCheckCohort(_previous: CohortState, form: FormData): Promise<CohortState> {
  const { db, organization } = await requireWorkspace(true, form);
  const keys = ["customer", "day", "kind", "freshness", "requestId", "confirmed"];
  if (keys.some((key) => form.getAll(key).length !== 1)) return { error: "Review one customer, business date and explicit post/listing scope, then confirm." };
  const input = z.object({ customer: z.uuid(), day: cohortDaySchema, kind: cohortKindSchema,
    freshness: z.coerce.number().int().min(60).max(1440), requestId: z.uuid(), confirmed: z.literal("on")
  }).safeParse(Object.fromEntries(keys.map((key) => [key, form.get(key)])));
  if (!input.success) return { error: "Review a valid prior business date, customer and scope. Freshness must be 60–1440 minutes." };
  const value = input.data;
  try {
    const result = await db.rpc("reporting_refresh_check_cohort_v1", {
      org: organization.id, customer: value.customer, day: value.day, kind: value.kind,
      freshness_minutes: value.freshness, request_id: value.requestId,
    }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) {
      if (isMissingSchemaError(result.error)) return { error: "The reviewed cohort protocol is not deployed here. No refresh was queued; ask your administrator to finish setup." };
      const message = result.error.message ?? "";
      if (message.includes("Cohort replay conflict")) return { error: "This request differs from its saved receipt. Reconcile cohort history; do not create a new request to bypass the conflict." };
      if (message.includes("Start an active work session")) return { error: "Start or resume an active work session first. Profile authorization is separate; nothing was enabled." };
      if (message.includes("Choose a prior business date")) return { error: "Choose yesterday or an earlier date in the selected customer's timezone." };
      if (message.includes("Cohort exceeds 500")) return { error: "This cohort exceeds the 500-record safety limit. Nothing was partly queued; choose a narrower authorized scope." };
      if (message.includes("Cohort request rate limit")) return { error: "Too many new cohort requests. Check existing progress; do not retry with new IDs." };
      return { error: "Refresh outcome is unconfirmed. Retry this same locked form or reconcile cohort history before issuing another request." };
    }
    const receipt = cohortReceiptSchema.safeParse(result.data);
    if (!receipt.success || receipt.data.organizationId !== organization.id || receipt.data.customerId !== value.customer
      || receipt.data.day !== value.day || receipt.data.kind !== value.kind || receipt.data.requestId !== value.requestId
      || receipt.data.freshnessMinutes !== value.freshness) {
      return { error: "Refresh receipt could not be verified. Reconcile cohort history; the request may already be saved. No automatic retry was started." };
    }
    revalidatePath("/dashboard/run/cohorts");
    return { receipt: receipt.data };
  } catch {
    return { error: "Refresh outcome is unconfirmed. Retry this same locked form or reconcile cohort history; no automatic retry was started." };
  }
}
