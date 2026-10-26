import { Temporal } from "@js-temporal/polyfill";

export const BUSINESS_TIME_ZONE = "America/Los_Angeles";

export function validTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(); return true; }
  catch { return false; }
}

export function businessDate(now = new Date(), zone = BUSINESS_TIME_ZONE): string {
  return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(zone).toPlainDate().toString();
}

export function shiftDay(day: string, amount: number): string {
  return Temporal.PlainDate.from(day).add({ days: amount }).toString();
}

export function dayRange(day: string, zone = BUSINESS_TIME_ZONE) {
  const date = Temporal.PlainDate.from(day);
  return {
    start: date.toZonedDateTime(zone).toInstant().toString(),
    end: date.add({ days: 1 }).toZonedDateTime(zone).toInstant().toString(),
  };
}

export function localDateTimeToUtc(value: string, zone = BUSINESS_TIME_ZONE): string | null {
  if (!value.trim()) return null;
  // Reject both nonexistent spring times and ambiguous fall times. Never guess an offset.
  return Temporal.PlainDateTime.from(value).toZonedDateTime(zone, { disambiguation: "reject" }).toInstant().toString();
}

export function formatTime(value: string | null, zone = BUSINESS_TIME_ZONE): string {
  if (!value) return "Time unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
}

export function isInDay(value: string | null, day: string, zone = BUSINESS_TIME_ZONE): boolean {
  if (!value) return false;
  const { start, end } = dayRange(day, zone);
  const instant = Date.parse(value);
  return instant >= Date.parse(start) && instant < Date.parse(end);
}

export function isStale(lastObservedAt: string | null, now = new Date()): boolean {
  return !lastObservedAt || now.getTime() - Date.parse(lastObservedAt) > 24 * 60 * 60 * 1000;
}

export function sessionSeconds(session: { started_at: string; ended_at: string | null; paused_at: string | null; paused_seconds: number }, now = new Date()): number {
  const end = session.ended_at || session.paused_at || now.toISOString();
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(session.started_at)) / 1000) - session.paused_seconds);
}
