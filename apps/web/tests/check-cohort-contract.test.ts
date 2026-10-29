import { describe, expect, it } from "vitest";
import { cohortDaySchema, cohortProgress, cohortReceiptSchema, cohortReportSchema } from "@/lib/check-cohort";
const org = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222", post = "33333333-3333-4333-8333-333333333333";
const receipt = { version: 1, policyVersion: 1, organizationId: org, cohortId: id, requestId: id, customerId: id, day: "2026-10-28", kind: "posts", timeZone: "America/Los_Angeles", freshnessMinutes: 60, total: 1, unknownDates: 2, queued: 1, active: 0, recent: 0, blocked: 0 };
const item = { publicationId: post, ordinal: 1, url: "https://nextdoor.com/p/fixture", accountLabel: "Fixture profile", publishedAt: "2026-10-28T12:00:00Z", disposition: "queued", jobId: id, status: "pending", outcome: null, completedAt: null, leaseExpiresAt: null, recentCheckedAt: null, recentOutcome: null };
const report = { receipt, createdAt: "2026-10-29T12:00:00Z", items: [item] };
describe("strict date-cohort contract", () => {
  it("accepts a complete bounded receipt and rejects inconsistent totals/extra fields", () => {
    expect(cohortReceiptSchema.safeParse(receipt).success).toBe(true);
    for (const bad of [{ ...receipt, total: 2 }, { ...receipt, token: "fixture" }, { ...receipt, policyVersion: 2 }, { ...receipt, freshnessMinutes: 0 }, { ...receipt, timeZone: "invalid-zone" }]) expect(cohortReceiptSchema.safeParse(bad).success).toBe(false);
  });
  it("requires real calendar dates rather than regex-shaped invalid dates", () => {
    expect(cohortDaySchema.safeParse("2024-02-29").success).toBe(true);
    for (const value of ["0000-01-01", "2026-02-29", "2026-13-01", "invalid", "2026-10-28T12:00:00Z"]) expect(cohortDaySchema.safeParse(value).success).toBe(false);
  });
  it("rejects lost, duplicate, reordered or mismatched snapshot items", () => {
    expect(cohortReportSchema.safeParse(report).success).toBe(true);
    for (const bad of [{ ...report, items: [] }, { ...report, items: [item, item] }, { ...report, items: [{ ...item, ordinal: 2 }] }, { ...report, items: [{ ...item, disposition: "recent" }] }, { ...report, items: [{ ...item, status: null }] }]) expect(cohortReportSchema.safeParse(bad).success).toBe(false);
  });
  it("separates waiting, expired leases, technical failures and prior results", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(cohortProgress(cohortReportSchema.parse(report), now).waiting).toBe(1);
    const expired = cohortReportSchema.parse({ ...report, items: [{ ...item, status: "leased", leaseExpiresAt: "2026-10-29T11:59:00Z" }] });
    expect(cohortProgress(expired, now)).toMatchObject({ running: 0, attention: 1, checked: 0 });
    const failure = cohortReportSchema.parse({ ...report, items: [{ ...item, status: "completed", outcome: "network_error", completedAt: "2026-10-29T11:59:00Z" }] });
    expect(cohortProgress(failure, now)).toMatchObject({ checked: 1, attention: 1 });
  });
  it("never labels malformed completion or a leased job without a deadline as valid", () => {
    for (const changes of [{ status: "completed" }, { status: "leased" }]) expect(cohortReportSchema.safeParse({ ...report, items: [{ ...item, ...changes }] }).success).toBe(false);
  });
});
