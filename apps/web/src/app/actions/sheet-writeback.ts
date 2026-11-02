"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { sheetDeliveryIntentSchema } from "@/lib/sheet-writeback-contract";
import type { FormState } from "./auth";

const enqueueInput = z.object({
  request: z.uuid(),
  stable: z.string().min(1).max(200),
  action: z.enum(["append", "update_cells"]),
  tab: z.string().min(1).max(80),
  rowRef: z.string().max(300).optional(),
  rows: z.string().min(2).max(262144),
  confirmed: z.literal("on"),
});

const rowValues = z.array(z.record(z.string().min(1).max(100), z.union([z.string().max(4000), z.null()])).refine((row) => Object.keys(row).length > 0 && Object.keys(row).length <= 100)).min(1).max(50);

/** Stages an explicit durable write intent in the shared backend only. No Sheet is contacted. */
export async function enqueueSheetWriteback(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization, user } = await requireWorkspace(true, form);
  if (!user.email_confirmed_at) return { error: "Verify your email before queueing a Sheet writeback intent." };
  const input = enqueueInput.safeParse({ request: form.get("requestId"), stable: form.get("stableKey"), action: form.get("action"), tab: form.get("tab"), rowRef: (form.get("rowRef") as string | null)?.trim() || undefined, rows: form.get("rows"), confirmed: form.get("confirmed") });
  if (!input.success) return { error: "Review the tab, row reference and row values and confirm before queueing." };
  if (input.data.action === "update_cells" && !input.data.rowRef) return { error: "update_cells intents require a stable row reference id:UUID. No intent was queued." };
  let declared: unknown;
  try { declared = JSON.parse(input.data.rows); } catch { return { error: "Row values are invalid JSON. No intent was queued." }; }
  const values = rowValues.safeParse(declared);
  if (!values.success) return { error: "Rows must be 1–50 objects of column/value pairs (text or empty/null only). No intent was queued." };
  const intent = sheetDeliveryIntentSchema.safeParse({ action: input.data.action, tab: input.data.tab, rowRef: input.data.action === "append" ? null : input.data.rowRef, values: values.data });
  if (!intent.success) return { error: intent.error.issues[0]?.message ?? "The write intent failed validation bounds. No intent was queued." };
  try {
    const result = await db.rpc("reporting_enqueue_sheet_writeback_v1", { org: organization.id, intent: intent.data, stable_key: input.data.stable, request_id: input.data.request }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) {
      if (/replay conflict|stable key conflict/i.test(result.error.message)) return { error: "This retry differs from its original request or the same key was already queued with different values. Reconcile the queue below before issuing another intent." };
      if (/Invalid writeback request/i.test(result.error.message)) return { error: "The backend rejected this intent's bounds. Review the tab, row reference and values, then retry this same form once." };
      return { error: "Queue outcome is unconfirmed. Retry this same form once, or reload and reconcile the queue; do not assume it failed." };
    }
    const receipt = z.object({ id: z.uuid(), seq: z.number().int().positive(), status: z.enum(["pending", "leased", "delivered", "conflict", "failed", "cancelled"]) }).strict().safeParse(result.data);
    if (!receipt.success || receipt.data.status !== "pending") return { error: "Queue receipt could not be verified. Reconcile the queue below before another intent." };
    revalidatePath("/dashboard/settings/sheet-writeback");
    return { success: `Intent #${receipt.data.seq} queued as pending. This dashboard action writes no Sheet cells; delivery requires the separately configured and explicitly authorized local runner. Check the queue for its actual outcome.` };
  } catch { return { error: "Queue outcome is unconfirmed. Retry this same form once, or reload and reconcile the queue; no automatic retry was started." }; }
}

const cancelInput = z.object({ item: z.uuid(), request: z.uuid(), confirmed: z.literal("on") });

/** Cancels one still-pending intent only; terminal and in-flight states are never rewritten. */
export async function cancelPendingSheetWriteback(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization, user } = await requireWorkspace(true, form);
  if (!user.email_confirmed_at) return { error: "Verify your email before cancelling a writeback intent." };
  const input = cancelInput.safeParse({ item: form.get("itemId"), request: form.get("requestId"), confirmed: form.get("confirmed") });
  if (!input.success) return { error: "Review the exact pending intent and confirm cancellation." };
  try {
    const result = await db.rpc("reporting_cancel_pending_sheet_writeback_v1", { org: organization.id, item_id: input.data.item, request_id: input.data.request }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) {
      if (/Only pending writeback can be cancelled/i.test(result.error.message)) return { error: "Only still-pending intents can be cancelled. The queue state changed; reload and review it again." };
      return { error: "Cancellation outcome is unconfirmed. Retry this same request once, or reload and reconcile the queue; do not assume it failed." };
    }
    const receipt = z.object({ id: z.uuid(), status: z.literal("cancelled") }).strict().safeParse(result.data);
    if (!receipt.success || receipt.data.id !== input.data.item) return { error: "Cancellation receipt could not be verified. Reconcile the queue before another request." };
    revalidatePath("/dashboard/settings/sheet-writeback");
    return { success: `Cancelled intent ${receipt.data.id}. No other intent was changed and no Sheet cell was touched.` };
  } catch { return { error: "Cancellation outcome is unconfirmed. Retry this same request once, or reload and reconcile the queue; no automatic retry was started." }; }
}

export async function setPublicationSheetMapping(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const input = z.strictObject({ publication: z.uuid(), tab: z.enum(["Auto Posting", "Auto Listing"]), row: z.uuid(),
    revision: z.coerce.number().int().min(1).max(999999997), enabled: z.enum(["true", "false"]), confirmed: z.literal("on") }).safeParse({
    publication: form.get("publication"), tab: form.get("tab"), row: form.get("row"), revision: form.get("revision"), enabled: form.get("enabled"), confirmed: form.get("confirmed"),
  });
  if (!input.success) return { error: "Review the exact publication, tab, stable ND Row ID and current Sheet revision, then explicitly confirm." };
  try {
    const protocol = await db.rpc("reporting_sheet_mapping_version").abortSignal(AbortSignal.timeout(15000));
    if (protocol.error || protocol.data !== 1) return { error: "The reviewed automatic-mapping migration is not available. Nothing was changed." };
    const result = await db.rpc("reporting_set_publication_sheet_mapping", { org: organization.id, publication: input.data.publication,
      tab_name: input.data.tab, stable_row: input.data.row, expected_revision: input.data.revision, enabled: input.data.enabled === "true" }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) return { error: "Mapping was not confirmed. Check the exact publication kind and reconcile outstanding intents before rebasing or enabling; refresh the saved mappings before retrying." };
    revalidatePath("/dashboard/settings/sheet-mapping");
    return { success: "Mapping saved. Only future sourced check results can queue intents while enabled; no historical replay or Google write was started by this action. Pausing does not cancel already queued intents." };
  } catch { return { error: "Mapping outcome is unconfirmed. Refresh the saved mappings before retrying; no historical replay was requested." }; }
}

export async function setPublishSheetTarget(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const input = z.object({ binding: z.uuid(), enabled: z.enum(["true", "false"]), checks: z.enum(["true", "false"]), confirmed: z.literal("on") })
    .safeParse({ binding: form.get("binding"), enabled: form.get("enabled"), checks: form.get("checks"), confirmed: form.get("confirmed") });
  if (!input.success) return { error: "Review the exact profile assignment and future-result permissions, then confirm." };
  try {
    const protocol = await db.rpc("reporting_sheet_mapping_version").abortSignal(AbortSignal.timeout(15000));
    if (protocol.error || protocol.data !== 1) return { error: "The reviewed automatic-mapping migration is not available. Nothing was changed." };
    const result = await db.rpc("reporting_set_publish_sheet_target", { org: organization.id, binding: input.data.binding,
      enabled: input.data.enabled === "true", include_checks: input.data.checks === "true" }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) return { error: "Future publication mapping was not confirmed. Refresh and verify the authorized assignment before retrying." };
    revalidatePath("/dashboard/settings/sheet-mapping");
    return { success: "Future-result policy saved. Only confirmed new publications can queue Sheet rows; ambiguous submissions never do. Existing row mappings and already queued writes are unchanged." };
  } catch { return { error: "Future-result policy outcome is unconfirmed. Refresh before retrying; no publication or Google write was started here." }; }
}
