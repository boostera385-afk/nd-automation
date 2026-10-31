"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { isAutomationKind, validateLocalPath, validateProfileInput } from "@/lib/automation-tasks";
import type { FormState } from "./auth";

const refresh = () => revalidatePath("/dashboard", "layout");

export async function enqueueBrowserTask(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const worker = z.uuid().safeParse(form.get("worker"));
  const kind = form.get("kind");
  if (!worker.success) return { error: "Choose the paired laptop that should run this task." };
  if (!isAutomationKind(kind)) return { error: "Choose a browser task that the worker is allowed to run." };
  if (form.get("confirmed") !== "on") return { error: "Confirm you want the paired laptop to run this task now." };

  let payload: Record<string, string>;
  let summary: string;
  if (kind === "profile_create") {
    const name = String(form.get("name") ?? "");
    const group = String(form.get("group") ?? "").trim();
    const os = String(form.get("os") ?? "windows");
    const invalid = validateProfileInput({ name, group, os });
    if (invalid) return { error: invalid };
    payload = { name: name.trim(), os, ...(group ? { group } : {}) };
    summary = `Create profile: ${name.trim()}`;
  } else if (kind === "cookie_import" || kind === "proxy_import") {
    const path = String(form.get("path") ?? "");
    const invalid = validateLocalPath(path);
    if (invalid) return { error: invalid };
    payload = { path: path.trim() };
    summary = kind === "cookie_import" ? "Check local cookie file" : "Check local proxy file";
  } else {
    payload = {};
    summary = "Read preset inventory";
  }

  const { error } = await db.rpc("reporting_enqueue_automation_task", {
    org: organization.id, worker: worker.data, kind, summary, payload,
  });
  if (error) return { error: "Task could not be queued. Check that the laptop is enabled, has no other queued task, and that the automation migration is applied." };
  refresh();
  return { success: "Task queued. The paired laptop runs it on its next poll; nothing runs in this browser tab." };
}

export async function cancelBrowserTask(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const task = z.uuid().safeParse(form.get("task"));
  if (!task.success) return { error: "Invalid task." };
  const { error } = await db.rpc("reporting_cancel_automation_task", { org: organization.id, task: task.data });
  if (error) return { error: "Only a task still waiting for the laptop can be cancelled. Refresh to see its state." };
  refresh();
  return { success: "Queued task cancelled before the laptop started it." };
}

export async function reconcileExpiredBrowserTask(_previous: FormState, form: FormData): Promise<FormState> {
  const { db, organization } = await requireWorkspace(true, form);
  const task = z.uuid().safeParse(form.get("task"));
  if (!task.success || form.get("reconciled") !== "on") return { error: "Confirm the laptop stopped and you have inspected Incogniton before reconciling." };
  const { error } = await db.rpc("reporting_reconcile_expired_automation_task", { org: organization.id, task: task.data });
  if (error) return { error: "Only an expired lease can be reconciled. Refresh to see the current state." };
  refresh();
  return { success: "Expired task closed. It will not be re-run automatically." };
}
