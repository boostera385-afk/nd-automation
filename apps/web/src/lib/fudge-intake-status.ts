import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const revisionSchema = z.object({
  id: z.uuid(), organization_id: z.uuid(), record_id: z.uuid(),
  revision: z.number().int().positive(), payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  observed_at: z.iso.datetime({ offset: true }), received_at: z.iso.datetime({ offset: true }),
}).strict();
export type IntakeRevision = z.infer<typeof revisionSchema>;
export type IntakeStatus = {
  available: boolean; records: number | null; revisions: number | null;
  recent: IntakeRevision[]; limited: boolean; loadedAt: string;
};

// Only receipt metadata is selected: no review text, names, photo URLs or tokens.
// Calls use the signed-in user's client and explicit organization filters, plus RLS.
export async function fetchFudgeIntakeStatus(db: SupabaseClient, organizationId: string): Promise<IntakeStatus> {
  const failed = (): IntakeStatus => ({ available: false, records: null, revisions: null, recent: [], limited: false, loadedAt: new Date().toISOString() });
  if (!z.uuid().safeParse(organizationId).success) return failed();
  try {
    const [records, revisions, recent] = await Promise.all([
      db.from("reporting_fudge_records").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
      db.from("reporting_fudge_revisions").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
      db.from("reporting_fudge_revisions")
        .select("id,organization_id,record_id,revision,payload_sha256,observed_at,received_at")
        .eq("organization_id", organizationId)
        .order("received_at", { ascending: false }).order("id", { ascending: false }).limit(51),
    ]);
    if (records.error || revisions.error || recent.error) return failed();
    const counts = z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).length(2).safeParse([records.count, revisions.count]);
    const rows = z.array(revisionSchema).max(51).safeParse(recent.data);
    if (!counts.success || !rows.success || rows.data.some((row) => row.organization_id !== organizationId)
      || new Set(rows.data.map((row) => row.id)).size !== rows.data.length) return failed();
    return { available: true, records: counts.data[0], revisions: counts.data[1], recent: rows.data.slice(0, 50), limited: rows.data.length > 50, loadedAt: new Date().toISOString() };
  } catch {
    // Never surface server error bodies or treat failed reads as an empty library.
    return failed();
  }
}
