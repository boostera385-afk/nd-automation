import { describe, expect, it } from "vitest";
import { businessDate, dayRange, formatTime, isInDay, localDateTimeToUtc, sessionSeconds, shiftDay, validTimeZone } from "@/lib/time";

describe("Pacific business time", () => {
  it("uses the Pacific date, not Pakistan/device midnight", () => {
    const instant = new Date("2026-10-26T02:00:00Z");
    expect(businessDate(instant)).toBe("2026-10-25");
    expect(businessDate(instant, "Asia/Karachi")).toBe("2026-10-26");
  });
  it("handles day/month/year rollover", () => {
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
  });
  it("uses a 23-hour spring business day", () => {
    const { start, end } = dayRange("2026-03-08");
    expect((Date.parse(end) - Date.parse(start)) / 3600000).toBe(23);
  });
  it("uses a 25-hour fall business day", () => {
    const { start, end } = dayRange("2026-11-01");
    expect((Date.parse(end) - Date.parse(start)) / 3600000).toBe(25);
  });
  it("rejects missing and repeated DST wall times instead of guessing", () => {
    expect(() => localDateTimeToUtc("2026-03-08T02:30")).toThrow();
    expect(() => localDateTimeToUtc("2026-11-01T01:30")).toThrow();
  });
  it("applies PST/PDT automatically", () => {
    expect(localDateTimeToUtc("2026-01-15T10:00")).toBe("2026-01-15T18:00:00Z");
    expect(localDateTimeToUtc("2026-07-15T10:00")).toBe("2026-07-15T17:00:00Z");
  });
  it("keeps unknown dates unknown", () => {
    expect(localDateTimeToUtc("")).toBeNull();
    expect(isInDay(null, "2026-10-26")).toBe(false);
    expect(formatTime(null)).toBe("Time unknown");
  });
  it("uses an exclusive day end", () => {
    const { start, end } = dayRange("2026-10-26");
    expect(isInDay(start, "2026-10-26")).toBe(true);
    expect(isInDay(end, "2026-10-26")).toBe(false);
  });
  it("validates timezone names", () => {
    expect(validTimeZone("America/Los_Angeles")).toBe(true);
    expect(validTimeZone("Not/AZone")).toBe(false);
  });
  it("stops elapsed time while paused and excludes closed pauses", () => {
    const base = { started_at: "2026-10-26T08:00:00Z", ended_at: null, paused_at: "2026-10-26T10:00:00Z", paused_seconds: 1800 };
    expect(sessionSeconds(base, new Date("2026-10-26T12:00:00Z"))).toBe(5400);
    expect(sessionSeconds({ ...base, ended_at: "2026-10-26T12:00:00Z", paused_at: null, paused_seconds: 9000 })).toBe(5400);
  });
});
