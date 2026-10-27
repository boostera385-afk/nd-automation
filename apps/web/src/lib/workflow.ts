import { z } from "zod";
import { classifyStatus, sheetRowSchema, validPostUrl, type SheetRow } from "./sheet-status";
import type { ImportedRow } from "./validation";

export { primaryNavigation, navigationSection } from "./workflow-navigation";

export const MASTER_TABS = ["Auto Posting", "Auto Listing", "Incog Profile Creation", "ND Acc Creation", "Bulk cookies import", "Bulk proxies import", "Auto Warmup", "Auto Random Posting"] as const;
export type MasterTab = typeof MASTER_TABS[number];
export const masterResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), sheet: z.enum(MASTER_TABS), fetchedAt: z.iso.datetime({ offset: true }), truncated: z.boolean(), rows: z.array(sheetRowSchema).max(5000) }),
  z.strictObject({ ok: z.literal(false), error: z.string().max(100) }),
]);

export type ProfileBinding = { id: string; worker_id: string; customer_id: string; profile_id: string; account_label: string; monitoring_session_id: string | null };
export type LocalWorker = { id: string; name: string; enabled: boolean; last_seen_at: string | null };
export type MonitoringJob = { id: string; publication_id: string; worker_id: string; status: string; outcome: string | null; created_at: string; lease_expires_at: string | null };

export function heartbeatState(worker: LocalWorker, now = Date.now()): string {
  if (!worker.enabled) return "Disabled";
  if (!worker.last_seen_at) return "Not paired yet";
  const age = now - Date.parse(worker.last_seen_at);
  return Number.isFinite(age) && age >= 0 && age < 120_000 ? "Seen recently" : "Offline or stale";
}

// A profile label is usable only when it resolves to one explicitly saved binding.
// Never infer customer identity from business names, row order or a partial match.
export function planMappedImport(rows: SheetRow[], bindings: ProfileBinding[]): { groups: { customer: string; records: ImportedRow[] }[]; unresolved: number; skipped: number } {
  const byLabel = new Map<string, ProfileBinding[]>();
  for (const binding of bindings) byLabel.set(binding.account_label, [...(byLabel.get(binding.account_label) ?? []), binding]);
  const groups = new Map<string, ImportedRow[]>();
  const seen = new Set<string>();
  let unresolved = 0, skipped = 0;
  for (const row of rows) {
    const kind = classifyStatus(row.status, row.postLink);
    const url = validPostUrl(row.postLink);
    if (!url || !["posted", "alive"].includes(kind)) { skipped++; continue; }
    const matches = byLabel.get(row.profileName.trim()) ?? [];
    if (matches.length !== 1) { unresolved++; continue; }
    const customer = matches[0].customer_id;
    const key = `${customer}:${url}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const title = row.title.replace(/\s+/g, " ").trim();
    const record: ImportedRow = { title: (title.length >= 3 ? title : `Sheet post (row ${row.rowNumber})`).slice(0, 200), url, account_label: matches[0].account_label, published_at: null };
    groups.set(customer, [...(groups.get(customer) ?? []), record]);
  }
  return { groups: [...groups].map(([customer, records]) => ({ customer, records })), unresolved, skipped };
}
