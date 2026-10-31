import { describe, expect, it } from "vitest";
import { heartbeatState, masterResponseSchema, navigationSection, planMappedImport, primaryNavigation, type ProfileBinding } from "@/lib/workflow";
import type { SheetRow } from "@/lib/sheet-status";

const binding: ProfileBinding = { id: "11111111-1111-4111-8111-111111111111", worker_id: "22222222-2222-4222-8222-222222222222", customer_id: "33333333-3333-4333-8333-333333333333", profile_id: "44444444-4444-4444-8444-444444444444", account_label: "Exact profile", monitoring_session_id: null };
const row: SheetRow = { rowNumber: 2, profileName: "Exact profile", title: "Source post", postLink: "https://nextdoor.com/p/known", status: "Posted" };

describe("simple navigation", () => {
  it("has exactly the five agreed main destinations", () => {
    expect(primaryNavigation.map((item) => item.label)).toEqual(["Home", "Master Sheet", "Run automation", "Profiles", "Results"]);
    expect(primaryNavigation.filter((item) => !item.staff).map((item) => item.label)).toEqual(["Home", "Results"]);
  });
  it.each(["automation", "publishing", "content", "reports", "sessions", "customers", "sheet-sync", "settings"])("keeps %s under Settings / More without deleting its route", (section) => {
    expect(navigationSection(`/dashboard/${section}`)).toBe("/dashboard/settings");
  });
  it.each(["posts/123", "posts/new", "checks", "comments", "today", "yesterday", "responses"])("groups %s under Results", (section) => {
    expect(navigationSection(`/dashboard/${section}`)).toBe("/dashboard/results");
  });
  it("does not prefix-match unrelated routes", () => {
    expect(navigationSection("/dashboard")).toBe("/dashboard");
    expect(navigationSection("/dashboard/master-sheet")).toBe("/dashboard/master-sheet");
    expect(navigationSection("/dashboard/profiles-unrelated")).toBe("/dashboard/settings");
  });
});

describe("saved profile mappings, not repeated manual assignment", () => {
  it("reuses the exact saved customer mapping without inventing dates or observations", () => {
    expect(planMappedImport([row], [binding])).toEqual({ groups: [{ customer: binding.customer_id, records: [{ title: row.title, url: row.postLink, account_label: binding.account_label, published_at: null }] }], unresolved: 0, skipped: 0 });
  });
  it("rejects missing, case-different and ambiguous labels instead of guessing", () => {
    expect(planMappedImport([row], []).unresolved).toBe(1);
    expect(planMappedImport([{ ...row, profileName: "exact profile" }], [binding]).unresolved).toBe(1);
    expect(planMappedImport([row], [binding, { ...binding, id: "another", customer_id: "different-customer" }]).unresolved).toBe(1);
  });
  it("ignores pending, failed, missing-link, deleted and Fudge Used rows", () => {
    const rows = ["", "Failed", "CLAIMED", "Used", "Post Deleted from ND"].map((status) => ({ ...row, status }));
    rows.push({ ...row, postLink: "" });
    expect(planMappedImport(rows, [binding])).toEqual({ groups: [], unresolved: 0, skipped: 6 });
  });
  it("deduplicates normalized URLs within a customer and preserves distinct customer attribution", () => {
    const second = { ...binding, id: "second", account_label: "Other profile", customer_id: "other-customer" };
    const result = planMappedImport([row, { ...row, postLink: `${row.postLink}?tracking=1` }, { ...row, profileName: "Other profile" }], [binding, second]);
    expect(result.groups).toHaveLength(2); expect(result.skipped).toBe(1);
  });
  it("imports Alive as a sheet claim, not as verified visibility", () => {
    const record = planMappedImport([{ ...row, status: "Alive" }], [binding]).groups[0].records[0];
    expect(record).not.toHaveProperty("visibility"); expect(record.published_at).toBeNull();
  });
});

describe("honest readiness and strict master metadata", () => {
  const worker = { id: "w", name: "Laptop", enabled: true, last_seen_at: null as string | null };
  it("distinguishes never registered, revoked, stale and recently seen without claiming browser readiness", () => {
    expect(heartbeatState(worker)).toBe("Not registered yet");
    expect(heartbeatState({ ...worker, enabled: false })).toBe("Disabled");
    expect(heartbeatState({ ...worker, last_seen_at: "2026-10-27T12:00:00Z" }, Date.parse("2026-10-27T12:01:00Z"))).toBe("Seen recently");
    expect(heartbeatState({ ...worker, last_seen_at: "2026-10-27T12:00:00Z" }, Date.parse("2026-10-27T12:03:00Z"))).toBe("Offline or stale");
    expect(heartbeatState({ ...worker, last_seen_at: "invalid" })).toBe("Offline or stale");
  });
  it("rejects credentials in preview output and invalid timestamps", () => {
    const value = { ok: true, sheet: "ND Acc Creation", fetchedAt: "2026-10-27T12:00:00Z", truncated: false, rows: [row] };
    expect(masterResponseSchema.safeParse(value).success).toBe(true);
    expect(masterResponseSchema.safeParse({ ...value, rows: [{ ...row, password: "must-not-leak" }] }).success).toBe(false);
    expect(masterResponseSchema.safeParse({ ...value, fetchedAt: "not a date" }).success).toBe(false);
  });
});
