import { z } from "zod";
import { dayRange, validTimeZone } from "./time";

export const cohortDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  try { dayRange(value); return value >= "0001-01-01"; } catch { return false; }
}, "Choose a valid business date.");
export const cohortKindSchema = z.enum(["posts", "listings", "both"]);
const count = z.number().int().nonnegative().max(500);
const stamp = z.iso.datetime({ offset: true });
export const cohortReceiptSchema = z.strictObject({
  version: z.literal(1), policyVersion: z.literal(1), organizationId: z.uuid(), cohortId: z.uuid(), requestId: z.uuid(), customerId: z.uuid(),
  day: cohortDaySchema, kind: cohortKindSchema, timeZone: z.string().min(1).max(100).refine(validTimeZone),
  freshnessMinutes: z.number().int().min(60).max(1440), total: count, unknownDates: z.number().int().nonnegative(),
  queued: count, active: count, recent: count, blocked: count,
}).refine((value) => value.queued + value.active + value.recent + value.blocked === value.total, "Cohort receipt totals disagree.");
const itemSchema = z.strictObject({
  publicationId: z.uuid(), ordinal: z.number().int().min(1).max(500), url: z.string().max(2000), accountLabel: z.string().min(1).max(120),
  publishedAt: stamp, disposition: z.enum(["queued", "active_job", "recent", "unsupported_link", "not_authorized", "worker_unavailable"]),
  jobId: z.uuid().nullable(), status: z.enum(["pending", "leased", "completed", "cancelled"]).nullable(),
  outcome: z.string().max(100).nullable(), completedAt: stamp.nullable(), leaseExpiresAt: stamp.nullable(),
  recentCheckedAt: stamp.nullable(), recentOutcome: z.string().max(100).nullable(),
}).superRefine((value, ctx) => {
  if ((["queued", "active_job"].includes(value.disposition)) !== (value.jobId !== null)
    || (value.jobId === null) !== (value.status === null)
    || (value.status === "completed" && (!value.completedAt || !value.outcome))
    || (value.status === "leased" && !value.leaseExpiresAt)
    || (value.disposition === "recent" && !value.recentCheckedAt)) {
    ctx.addIssue({ code: "custom", message: "Cohort item states disagree." });
  }
});
export const cohortReportSchema = z.strictObject({ receipt: cohortReceiptSchema, createdAt: stamp, items: z.array(itemSchema).max(500) }).superRefine((report, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "Cohort snapshot could not be reconciled." });
  if (report.items.length !== report.receipt.total || new Set(report.items.map((item) => item.publicationId)).size !== report.items.length
    || report.items.some((item, index) => item.ordinal !== index + 1)) invalid();
  const jobs = report.items.flatMap((item) => item.jobId ? [item.jobId] : []);
  if (new Set(jobs).size !== jobs.length) invalid();
  const counts = { queued: 0, active: 0, recent: 0, blocked: 0 };
  for (const item of report.items) {
    if (item.disposition === "queued") counts.queued++;
    else if (item.disposition === "active_job") counts.active++;
    else if (item.disposition === "recent") counts.recent++;
    else counts.blocked++;
    if (item.jobId !== null && item.status === null) invalid();
  }
  if (Object.entries(counts).some(([key, value]) => report.receipt[key as keyof typeof counts] !== value)) invalid();
});
export type CohortReceipt = z.infer<typeof cohortReceiptSchema>;
export type CohortReport = z.infer<typeof cohortReportSchema>;

export function cohortProgress(report: CohortReport, now = Date.now()) {
  const counts = { waiting: 0, running: 0, checked: 0, recent: 0, attention: 0, cancelled: 0, blocked: 0 };
  for (const item of report.items) {
    if (item.disposition === "recent") counts.recent++;
    else if (item.jobId === null) counts.blocked++;
    else if (item.status === "pending") counts.waiting++;
    else if (item.status === "leased") {
      if (!item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= now) counts.attention++;
      else counts.running++;
    } else if (item.status === "cancelled") counts.cancelled++;
    else if (item.status === "completed") {
      counts.checked++;
      if (item.outcome !== "alive") counts.attention++;
    }
  }
  return counts;
}
