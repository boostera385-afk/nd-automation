"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDashboardData, requireWorkspace } from "@/lib/data";
import { fetchSheetRows, SheetSyncError } from "@/lib/sheet-sync";
import { buildHealthReport, type HealthReport } from "@/lib/sheet-health";
import { buildSyncView, MAX_IMPORT, SHEET_TABS, sheetRowSchema, type ExistingPublication, type SheetRow, type SyncView } from "@/lib/sheet-status";
import { MAX_UPLOAD_ROWS } from "@/lib/sheet-table";
import { importedRow, uuid, type ImportedRow } from "@/lib/validation";
import type { FormState } from "./auth";

export type SyncState = FormState & { view?: SyncView; health?: HealthReport; sheet?: string; source?: "live" | "upload"; fetchedAt?: string; sourceTruncated?: boolean; dashboardPartial?: boolean };

// Read-only analysis of sheet data from either source: the connected sheet, or rows the browser extracted from an
// uploaded file (only four safe columns; credentials never leave the browser). Nothing is written here.
export async function runSheetAnalysis(_previous: SyncState, form: FormData): Promise<SyncState> {
  await requireWorkspace(true, form);
  const source = z.enum(["live", "upload"]).safeParse(form.get("source"));
  if (!source.success) return { error: "Choose where the sheet data comes from." };

  let rows: SheetRow[];
  let label: string;
  let fetchedAt = new Date().toISOString();
  let sourceTruncated = false;
  if (source.data === "live") {
    const sheet = z.enum(SHEET_TABS).safeParse(form.get("sheet"));
    if (!sheet.success) return { error: "Choose which sheet tab to read." };
    try {
      const fetched = await fetchSheetRows(sheet.data);
      rows = fetched.rows; fetchedAt = fetched.fetchedAt; sourceTruncated = fetched.truncated; label = sheet.data;
    } catch (error) {
      if (error instanceof SheetSyncError) return { error: error.message };
      return { error: "The sheet could not be read. Nothing was changed." };
    }
  } else {
    const raw = String(form.get("rows") ?? "");
    if (!raw || raw.length > 1_500_000) return { error: "Choose a file first. It must be smaller than about 1.5 MB after unneeded columns are removed." };
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return { error: "The file could not be read. Choose it again." }; }
    const parsed = z.array(sheetRowSchema).max(MAX_UPLOAD_ROWS).safeParse(json);
    if (!parsed.success) return { error: "That file did not have the expected columns. Export the tab with its header row and try again." };
    rows = parsed.data;
    label = String(form.get("label") ?? "Uploaded file").trim().slice(0, 80) || "Uploaded file";
    sourceTruncated = form.get("truncated") === "1";
  }

  const { publications, truncated } = await getDashboardData();
  const existing = new Map<string, ExistingPublication>(publications.map((post) => [post.url, { id: post.id, visibility: post.visibility }]));
  const profileCustomers = new Map<string, Set<string>>();
  for (const post of publications) profileCustomers.set(post.account_label, (profileCustomers.get(post.account_label) ?? new Set<string>()).add(post.customer_id));

  return {
    view: buildSyncView(rows, existing, profileCustomers),
    health: buildHealthReport(rows),
    sheet: label,
    source: source.data,
    fetchedAt,
    sourceTruncated,
    dashboardPartial: truncated,
    success: "Read-only analysis complete. Nothing was written to the sheet or saved here.",
  };
}

const decision = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), customerId: uuid }),
  z.object({ mode: z.literal("new"), name: z.string().trim().min(2, "Give each new client a name of at least 2 characters.").max(120) }),
  z.object({ mode: z.literal("skip") }),
]);

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

// Saves the reviewed posts, each under the client chosen for its profile. New clients are created first. Posts are
// recorded as "not checked" with an unknown publication date; duplicates are skipped by the database.
export async function importSheetPosts(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  if (form.get("authorized") !== "on") return { error: "Confirm the data is authorized and the preview was reviewed." };
  let rawRecords: unknown, rawAssignments: unknown;
  try { rawRecords = JSON.parse(String(form.get("records") ?? "")); rawAssignments = JSON.parse(String(form.get("assignments") ?? "")); }
  catch { return { error: "Invalid preview data. Analyse the sheet again." }; }
  const records = z.array(importedRow).min(1).max(MAX_IMPORT).safeParse(rawRecords);
  const assignments = z.record(z.string().max(120), decision).safeParse(rawAssignments);
  if (!records.success) return { error: "Invalid import. Analyse the sheet again." };
  if (!assignments.success) return { error: assignments.error.issues[0]?.message || "Check the client chosen for each profile." };

  const { customers } = await getDashboardData();
  const customerIds = new Set(customers.map((customer) => customer.id));
  const byName = new Map(customers.map((customer) => [customer.name.trim().toLowerCase(), customer.id]));

  const groups = new Map<string, ImportedRow[]>();
  const newNames = new Map<string, string>();
  let skipped = 0;
  for (const record of records.data) {
    const choice = assignments.data[record.account_label];
    if (!choice) return { error: `Choose a client for “${record.account_label}”, or skip it.` };
    if (choice.mode === "skip") { skipped++; continue; }
    let key: string;
    if (choice.mode === "existing") {
      if (!customerIds.has(choice.customerId)) return { error: "A chosen client is no longer available. Analyse the sheet again." };
      key = choice.customerId;
    } else {
      const lower = choice.name.toLowerCase();
      const found = byName.get(lower);
      if (found) key = found; else { key = `new:${lower}`; newNames.set(key, choice.name); }
    }
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  if (groups.size === 0) return { error: "Nothing to import: every profile was skipped." };

  const created = new Map<string, string>();
  for (const [key, name] of newNames) {
    const result = await db.from("reporting_customers").insert({ organization_id: organization.id, name, time_zone: organization.time_zone }).select("id").single();
    if (result.error || !result.data) return { error: `The client “${name}” could not be created, so no posts were saved${created.size ? ` (clients already created: ${created.size})` : ""}. Try again.` };
    created.set(key, result.data.id as string);
  }

  let saved = 0, existing = 0;
  for (const [key, list] of groups) {
    const customer = created.get(key) ?? key;
    for (const part of chunk(list, 100)) {
      const { data, error } = await db.rpc("reporting_add_publications", { org: organization.id, customer, records: part, record_source: "sheet_import" });
      if (error) { revalidatePath("/dashboard", "layout"); return { error: `Stopped after saving ${saved} posts. The rest were not saved: verify the data and analyse the sheet again.` }; }
      saved += Number(data); existing += part.length - Number(data);
    }
  }
  revalidatePath("/dashboard", "layout");
  const parts = [`${saved} new ${saved === 1 ? "post" : "posts"} saved for ${groups.size} ${groups.size === 1 ? "client" : "clients"}${created.size ? ` (${created.size} new)` : ""}`, existing ? `${existing} already existed` : "", skipped ? `${skipped} skipped` : ""].filter(Boolean);
  return { success: `${parts.join(" · ")}. All stay “not checked” with an unknown publication date until someone checks them.` };
}
