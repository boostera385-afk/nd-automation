"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext, requireWorkspace } from "@/lib/data";
import { localDateTimeToUtc } from "@/lib/time";
import { importRowsSchema, publicationInput, timeZoneSchema, uuid, visibilitySchema } from "@/lib/validation";
import { previewCsv } from "@/lib/imports";
import type { FormState } from "./auth";
import type { ImportedRow } from "@/lib/validation";

const refresh = () => revalidatePath("/dashboard", "layout");

export async function createWorkspace(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await getContext();
  if (organization) return { error: "You already have a workspace." };
  const name = z.string().trim().min(2).max(100).safeParse(form.get("name"));
  if (!name.success) return { error: "Workspace name must be 2–100 characters." };
  const { error } = await db.rpc("reporting_create_workspace", { workspace_name: name.data });
  if (error?.message.includes("Verify your email")) return { error: "Please verify your email before creating your workspace. Open the confirmation link sent to your inbox." };
  if (error) return { error: "Workspace creation failed. Check the migration or existing membership." };
  refresh();
  redirect("/dashboard");
}

export async function createCustomer(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const input = z.object({ name: z.string().trim().min(2).max(120), service: z.string().trim().max(160), time_zone: timeZoneSchema }).safeParse({ name: form.get("name"), service: form.get("service"), time_zone: form.get("time_zone") });
  if (!input.success) return { error: input.error.issues[0].message };
  const { error } = await db.from("reporting_customers").insert({ organization_id: organization.id, ...input.data });
  if (error) return { error: "Customer could not be saved. No record was changed." };
  refresh();
  return { success: "Customer saved." };
}

export async function addPublication(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const customerId = uuid.safeParse(form.get("customer_id"));
  if (!customerId.success) return { error: "Choose a customer." };
  const customer = await db.from("reporting_customers").select("time_zone").eq("organization_id", organization.id).eq("id", customerId.data).maybeSingle();
  if (customer.error || !customer.data) return { error: "Customer is unavailable." };
  let publishedAt: string | null;
  try { publishedAt = localDateTimeToUtc(String(form.get("published_local") || ""), customer.data.time_zone as string); }
  catch { return { error: "That local time is invalid or repeats during daylight saving. Leave it unknown or record an unambiguous time." }; }
  const input = publicationInput.safeParse({ customer_id: customerId.data, title: form.get("title"), url: form.get("url"), account_label: form.get("account_label"), published_at: publishedAt });
  if (!input.success) return { error: input.error.issues[0].message };
  if (publishedAt && Date.parse(publishedAt) > Date.now() + 300000) return { error: "This is a reporting ledger, not a publishing scheduler. Enter an actual past publication time or leave it unknown." };
  if (form.get("authorized") !== "on") return { error: "Confirm that this is an authorized customer post." };
  const { customer_id, ...record } = input.data;
  const { data, error } = await db.rpc("reporting_add_publications", { org: organization.id, customer: customer_id, records: [record], record_source: "manual_entry" });
  if (error) return { error: "Post record could not be saved. Check the URL, customer and publication time." };
  refresh();
  return { success: data === 0 ? "This customer already has that post URL; no duplicate was created." : "Post recorded as unverified. No platform action was performed." };
}

export async function recordObservation(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const input = z.object({ publication: uuid, new_visibility: visibilitySchema.exclude(["not_checked"]), total_comments: z.number().int().min(0).max(10000000).nullable(), review_notes: z.string().trim().max(2000) }).safeParse({
    publication: form.get("publication_id"), new_visibility: form.get("visibility"),
    total_comments: form.get("comments_total") === "" ? null : Number(form.get("comments_total")), review_notes: form.get("notes"),
  });
  if (!input.success) return { error: input.error.issues[0].message };
  if (form.get("reviewed") !== "on") return { error: "Confirm you reviewed the exact post in an authorized view." };
  if (input.data.new_visibility === "confirmed_removed" && input.data.review_notes.length < 10) return { error: "Describe the explicit platform removal evidence; an inaccessible post alone is not proof." };
  const target = await db.from("reporting_publications").select("id").eq("organization_id", organization.id).eq("id", input.data.publication).maybeSingle();
  if (target.error || !target.data) return { error: "That post is not available in the selected business. Nothing was saved." };
  const { error } = await db.rpc("reporting_record_observation", { ...input.data, collection_complete: form.get("complete") === "on" });
  if (error) return { error: "Observation could not be recorded. You may not have access to that post." };
  refresh();
  return { success: "Manual observation saved with server time. This is not an automatic live check." };
}

export async function addComment(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization, user } = await requireWorkspace(true, form);
  const input = z.object({ publication_id: uuid, author_label: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(5000), source_comment_id: z.string().trim().max(200) }).safeParse({ publication_id: form.get("publication_id"), author_label: form.get("author_label"), body: form.get("body"), source_comment_id: form.get("source_comment_id") });
  if (!input.success) return { error: input.error.issues[0].message };
  const { error } = await db.from("reporting_comments").insert({ ...input.data, source_comment_id: input.data.source_comment_id || null, organization_id: organization.id, created_by: user.id });
  if (error) return { error: "Comment could not be saved. Check access or whether that external comment ID already exists." };
  refresh();
  return { success: "Comment recorded as newly observed. No platform creation time was inferred." };
}

export async function sessionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const action = z.enum(["start", "pause", "resume", "end"]).safeParse(form.get("action"));
  const zone = timeZoneSchema.safeParse(form.get("device_zone"));
  if (!action.success || !zone.success) return { error: "Could not validate the session action or device timezone." };
  const { error } = await db.rpc("reporting_session_action", { org: organization.id, action: action.data, device_zone: zone.data });
  if (error) return { error: "Session could not be changed. Refresh and try again." };
  refresh();
  return { success: "Work session updated. Only explicitly enabled read-only monitoring follows this session; no publishing or account creation was started." };
}

export type ImportState = FormState & { rows?: ImportedRow[]; errors?: string[]; customerId?: string };

export async function previewImport(_previous: ImportState, form: FormData): Promise<ImportState> {
  await requireWorkspace(true, form);
  const customer = uuid.safeParse(form.get("customer_id"));
  if (!customer.success) return { error: "Choose the customer for this import." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > 512 * 1024) return { error: "Choose a CSV file smaller than 512 KB." };
  const result = previewCsv(await file.text());
  return { ...result, customerId: customer.data, success: result.errors.length ? undefined : "Preview only. Nothing has been saved or posted." };
}

export async function confirmImport(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  if (form.get("authorized") !== "on") return { error: "Confirm the data is authorized and the preview was reviewed." };
  const customer = uuid.safeParse(form.get("customer_id"));
  let records: unknown;
  try { records = JSON.parse(String(form.get("records") || "")); } catch { return { error: "Invalid preview data. Upload the file again." }; }
  const rows = importRowsSchema.safeParse(records);
  if (!customer.success || !rows.success) return { error: "Invalid import. Preview the file again." };
  const { data, error } = await db.rpc("reporting_add_publications", { org: organization.id, customer: customer.data, records: rows.data, record_source: "sheet_import" });
  if (error) return { error: "Import failed. No partial batch was saved. Verify the customer, fields and timestamps." };
  refresh();
  return { success: `${data} new records saved; ${rows.data.length - Number(data)} existing URLs skipped. All imported statuses remain unverified.` };
}
