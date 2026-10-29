"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { getOperationsData } from "@/lib/operations-data";
import { fetchSheetRows, SheetSyncError } from "@/lib/sheet-sync";
import { planMappedImport } from "@/lib/workflow";
import type { FormState } from "./auth";

export async function syncMappedPosts(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const sheet = z.enum(["Auto Posting", "Auto Listing"]).safeParse(form.get("sheet"));
  if (!sheet.success) return { error: "Choose the posting or listing tab." };
  const operations = await getOperationsData();
  if (!operations.available || operations.bindingsLimited) return { error: "Profile mappings are unavailable or incomplete. Open Profiles before syncing." };
  let fetched;
  try { fetched = await fetchSheetRows(sheet.data); }
  catch (error) { return { error: error instanceof SheetSyncError ? error.message : "Could not read the master Sheet. Nothing was saved." }; }
  const plan = planMappedImport(fetched.rows, operations.bindings);
  let saved = 0, existing = 0;
  for (const group of plan.groups) {
    for (let start = 0; start < group.records.length; start += 100) {
      const records = group.records.slice(start, start + 100);
      const { data, error } = await db.rpc("reporting_add_publications", { org: organization.id, customer: group.customer, records, record_source: "sheet_import" });
      if (error) { revalidatePath("/dashboard", "layout"); return { error: `Sync stopped after ${saved} new links. Earlier batches are saved; remaining batches were not. Sync again safely after checking access.` }; }
      const count = z.number().int().min(0).max(records.length).safeParse(data);
      if (!count.success) { revalidatePath("/dashboard", "layout"); return { error: "The server returned an unexpected saved count. Review Results before syncing again; the last batch may already be saved." }; }
      saved += count.data; existing += records.length - count.data;
    }
  }
  revalidatePath("/dashboard", "layout");
  return { success: `${saved} new links saved, ${existing} already recorded. ${plan.unresolved} need a profile/customer mapping; ${plan.skipped} other rows skipped.${fetched.truncated ? " Partial source: later rows were not read." : ""} Sheet values are unchanged; imported dates remain unknown and visibility not checked.` };
}

export async function setBatchMonitoring(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const selected = z.array(z.uuid()).min(1).max(100).safeParse(form.getAll("binding"));
  const mode = z.enum(["enable", "disable"]).safeParse(form.get("mode"));
  if (!selected.success || !mode.success || form.get("confirmed") !== "on") return { error: "Select up to 100 profiles and confirm this batch." };
  const ids = [...new Set(selected.data)];
  const operations = await getOperationsData();
  if (!operations.available || ids.some((id) => !operations.bindings.some((binding) => binding.id === id))) return { error: "An assignment is no longer available. Refresh before trying again." };
  if (mode.data === "enable" && ids.some((id) => {
    const binding = operations.bindings.find((item) => item.id === id)!;
    return !operations.workers.some((worker) => worker.id === binding.worker_id && worker.enabled);
  })) return { error: "One or more selected profiles have a disabled or unavailable worker. No profiles were enabled." };
  let changed = 0;
  for (const binding of ids) {
    const { error } = await db.rpc("reporting_set_profile_monitoring", { org: organization.id, binding, enabled: mode.data === "enable" });
    if (error) { revalidatePath("/dashboard", "layout"); return { error: `Updated ${changed} profiles, then stopped. Start an active work session and check worker availability. Refresh to review which changes were saved.` }; }
    changed++;
  }
  revalidatePath("/dashboard", "layout");
  return { success: mode.data === "enable" ? `Monitoring enabled for ${changed} profiles in this work session. The paired local agent will plan due checks; this does not publish anything.` : `Monitoring disabled for ${changed} profiles and their pending checks cancelled. An in-flight read may finish.` };
}
