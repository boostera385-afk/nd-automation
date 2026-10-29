import "server-only";
import { z } from "zod";
import { requireWorkspace } from "./data";
import { cohortReceiptSchema, cohortReportSchema } from "./check-cohort";
import { isMissingSchemaError } from "./checks";

const historySchema = z.array(z.strictObject({ id: z.uuid(), organization_id: z.uuid(), receipt: cohortReceiptSchema, created_at: z.iso.datetime({ offset: true }) })).max(20);

export async function loadCohortHistory() {
  const { db, organization } = await requireWorkspace(true);
  try {
    const result = await db.from("reporting_check_cohorts").select("id,organization_id,receipt,created_at").eq("organization_id", organization.id)
      .order("created_at", { ascending: false }).order("id").limit(20).abortSignal(AbortSignal.timeout(15000));
    if (result.error) return { available: false as const, setup: isMissingSchemaError(result.error), rows: [] };
    const parsed = historySchema.safeParse(result.data);
    if (!parsed.success || new Set(parsed.data.map((row) => row.id)).size !== parsed.data.length
      || parsed.data.some((row) => row.organization_id !== organization.id || row.receipt.organizationId !== organization.id || row.receipt.cohortId !== row.id)) {
      return { available: false as const, setup: false, rows: [] };
    }
    return { available: true as const, setup: false, rows: parsed.data };
  } catch { return { available: false as const, setup: false, rows: [] }; }
}

export async function loadCohortReport(id: string) {
  const { db, organization } = await requireWorkspace(true);
  if (!z.uuid().safeParse(id).success) return { available: true as const, report: null };
  try {
    const result = await db.rpc("reporting_get_check_cohort_v1", { org: organization.id, cohort_id: id }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) return { available: false as const, report: null };
    const parsed = cohortReportSchema.nullable().safeParse(result.data);
    if (!parsed.success || (parsed.data && (parsed.data.receipt.organizationId !== organization.id || parsed.data.receipt.cohortId !== id))) return { available: false as const, report: null };
    return { available: true as const, report: parsed.data };
  } catch { return { available: false as const, report: null }; }
}
