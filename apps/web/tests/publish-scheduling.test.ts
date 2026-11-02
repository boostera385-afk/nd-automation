import { expect, it } from "vitest";
import { scheduledEntries } from "@/lib/publish-scheduling";
const draftId = "11111111-1111-4111-8111-111111111111";
const entry = { draftId, revision: 2, localTime: "2026-11-02T09:30", windowMinutes: 10 };
const now = new Date("2026-11-02T16:00:00Z");

it("converts only business-local time to an explicit UTC instant", () => {
  expect(scheduledEntries([entry], "America/Los_Angeles", now)).toEqual([{ draftId, revision: 2, notBefore: "2026-11-02T17:30:00Z", windowMinutes: 10 }]);
});
it("leaves immediate dispatch null rather than assigning a misleading client clock time", () => {
  expect(scheduledEntries([{ ...entry, localTime: "" }], "America/Los_Angeles", now)[0].notBefore).toBeNull();
});
it.each(["2026-11-01T01:30", "2027-03-14T02:30"])("rejects ambiguous/nonexistent Pacific DST time %s", (localTime) => {
  expect(() => scheduledEntries([{ ...entry, localTime }], "America/Los_Angeles", new Date("2026-11-01T00:00:00Z"))).toThrow();
});
it.each(["2026-11-02T09:30Z", "2026-11-02T09:30-08:00", "2026-11-01T09:30", "2026-11-04T09:30"])("rejects offsets or out-of-window input %s", (localTime) => {
  expect(() => scheduledEntries([{ ...entry, localTime }], "America/Los_Angeles", now)).toThrow();
});
it("rejects duplicate/unbounded selection, invalid revision and unknown keys", () => {
  for (const value of [[], [entry, entry], Array(21).fill(entry), [{ ...entry, revision: 0 }], [{ ...entry, organizationId: "forged" }]]) {
    expect(() => scheduledEntries(value, "America/Los_Angeles", now)).toThrow();
  }
});
