"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { previewProfileCsv, profileRowSchema, type ProfileRow } from "@/lib/profiles";
import type { FormState } from "./auth";

export type ProfileImportState = FormState & { rows?: ProfileRow[]; errors?: string[] };
const refresh = () => revalidatePath("/dashboard/profiles");

export async function previewProfiles(_previous: ProfileImportState, form: FormData): Promise<ProfileImportState> {
  await requireWorkspace(true, form);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV inventory export to preview." };
  if (file.size > 1024 * 1024) return { error: "Import file must be smaller than 1 MB." };
  const { rows, errors } = previewProfileCsv(await file.text());
  if (errors.length > 0) return { errors, rows };
  return { rows, success: `${rows.length} profiles ready to review. Import does not launch, create or verify any browser profile.` };
}

export async function confirmProfileImport(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  if (form.get("confirmed") !== "on") return { error: "Confirm this inventory was exported from your authorized Incogniton installation." };
  const records = z.string().max(2_100_000).safeParse(form.get("records"));
  let rows: unknown;
  try { rows = JSON.parse(records.success ? records.data : ""); } catch { return { error: "Preview data could not be read. Preview again." }; }
  const parsed = z.array(profileRowSchema).min(1).max(5000).safeParse(rows);
  if (!records.success || !parsed.success) return { error: "Preview data is invalid or changed. Preview again." };
  const archiveMissing = form.get("archive_missing") === "on";
  if (archiveMissing && form.get("archive_confirmed") !== "on") return { error: "Also confirm archiving of profiles missing from this export." };
  const { data, error } = await db.rpc("reporting_import_profiles", { org: organization.id, rows: parsed.data, archive_missing: archiveMissing });
  if (error) return { error: "Import failed validation or organization checks. No partial import was committed." };
  const counts = data as { received: number; inserted: number; updated: number; archived: number };
  refresh();
  revalidatePath("/dashboard/automation");
  return { success: `Imported ${counts.received}: ${counts.inserted} new, ${counts.updated} updated${archiveMissing ? `, ${counts.archived} archived as missing` : ""}.` };
}

export async function setProfileArchived(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const profile = z.uuid().safeParse(form.get("profile"));
  const archived = form.get("archived") === "true";
  if (!profile.success || form.get("confirmed") !== "on") return { error: "Confirm this inventory status change." };
  const { error } = await db.rpc("reporting_set_profile_archived", { org: organization.id, profile: profile.data, archived });
  if (error) return { error: "Profile status could not be changed." };
  refresh();
  return { success: archived ? "Profile archived in inventory. Existing assignments are unchanged; launch decisions still need live readiness." : "Profile reactivated in inventory. This does not verify it exists locally." };
}
