import { z } from "zod";
import { localDateTimeToUtc, validTimeZone } from "./time";

const row = z.strictObject({ draftId: z.uuid(), revision: z.number().int().positive().max(2147483647),
  localTime: z.string().max(32), windowMinutes: z.number().int().min(5).max(30) });
export const publishScheduleInput = z.array(row).min(1).max(20).refine(
  (rows) => new Set(rows.map((item) => item.draftId)).size === rows.length, "Each draft can appear only once.",
);

/** Convert only in the authorized business timezone; reject DST gaps/ambiguity. */
export function scheduledEntries(value: unknown, zone: string, now = new Date()) {
  const rows = publishScheduleInput.parse(value);
  if (!validTimeZone(zone)) throw new Error("The business timezone is invalid.");
  return rows.map(({ localTime, ...item }) => {
    if (localTime && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(localTime)) throw new Error("Use a business-local date and time without an offset.");
    const notBefore = localTime ? localDateTimeToUtc(localTime, zone) : null;
    if (notBefore && (Date.parse(notBefore) < now.getTime() - 5000 || Date.parse(notBefore) > now.getTime() + 8 * 3600000)) {
      throw new Error("Choose a time within the next eight hours and your current work session.");
    }
    return { ...item, notBefore };
  });
}

export const publishBatchReceipt = z.array(z.strictObject({ jobId: z.uuid(), draftId: z.uuid(), revision: z.number().int().positive(),
  notBefore: z.iso.datetime({ offset: true }), dispatchUntil: z.iso.datetime({ offset: true }) })).min(1).max(20);
