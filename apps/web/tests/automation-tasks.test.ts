import { describe, expect, it } from "vitest";
import { automationKinds, describeResult, gatedTasks, isAutomationKind, kindLabels, statusLabels, statusTones, validateLocalPath, validateProfileInput, validateWriteInput, type AutomationTask } from "@/lib/automation-tasks";

const base: AutomationTask = {
  id: "11111111-1111-4111-8111-111111111111",
  worker_id: "22222222-2222-4222-8222-222222222222",
  kind: "preset_snapshot",
  status: "succeeded",
  summary: "Read preset inventory",
  payload: {},
  result: { profiles: 7, groups: 2, launched: 1 },
  error: null,
  created_at: "2026-10-31T10:00:00.000Z",
  completed_at: "2026-10-31T10:01:00.000Z",
  lease_expires_at: null,
};
const task = (overrides: Partial<AutomationTask>): AutomationTask => ({ ...base, ...overrides });

describe("task kinds", () => {
  it("lists only the six executable kinds", () => {
    expect(automationKinds).toEqual(["profile_create", "preset_snapshot", "cookie_import", "proxy_import", "cookie_write", "proxy_write"]);
    expect(isAutomationKind("profile_create")).toBe(true);
    expect(isAutomationKind("publish_post")).toBe(false);
    expect(isAutomationKind("cookie_write_all")).toBe(false);
    expect(isAutomationKind(null)).toBe(false);
    expect(Object.keys(kindLabels).sort()).toEqual([...automationKinds].sort());
  });

  it("keeps posting, listings, account creation and presets gated with a reason each", () => {
    const labels = gatedTasks.map((item) => item.label);
    expect(labels).toEqual(["Auto Posting", "Auto Listing", "ND Acc Creation", "Content presets / warmup"]);
    expect(gatedTasks.every((item) => item.reason.length > 30)).toBe(true);
  });

  it("has a label and tone for every status", () => {
    expect(Object.keys(statusLabels)).toHaveLength(5);
    expect(Object.keys(statusTones)).toHaveLength(5);
  });
});

describe("profile input", () => {
  it("accepts a normal profile request", () => {
    expect(validateProfileInput({ name: "Thomas Gutierrez 2", group: "Team A", os: "windows" })).toBeNull();
  });

  it("rejects short names, control characters, long groups and unknown systems", () => {
    expect(validateProfileInput({ name: "a", group: "", os: "windows" })).toMatch(/2–60/);
    expect(validateProfileInput({ name: "bad\u0007", group: "", os: "windows" })).toMatch(/control/);
    expect(validateProfileInput({ name: "ok", group: "x".repeat(61), os: "windows" })).toMatch(/60/);
    expect(validateProfileInput({ name: "ok", group: "", os: "solaris" })).toMatch(/Windows/);
  });
});

describe("local path", () => {
  it("accepts absolute Windows, UNC and POSIX paths", () => {
    expect(validateLocalPath("C:\\Exports\\cookies.txt")).toBeNull();
    expect(validateLocalPath("\\\\fileserver\\share\\cookies.txt")).toBeNull();
    expect(validateLocalPath("/home/operator/cookies.txt")).toBeNull();
  });

  it("rejects relative paths and upward traversal", () => {
    for (const value of ["cookies.txt", "./cookies.txt", "C:\\Exports\\..\\secret.txt", "", "  "]) {
      expect(validateLocalPath(value), value).not.toBeNull();
    }
  });
});

describe("write input", () => {
  it("accepts one canonical profile UUID with an absolute path", () => {
    expect(validateWriteInput({ profile: "44444444-4444-4444-8444-444444444444", path: "C:\\Exports\\cookies.txt" })).toBeNull();
  });

  it("rejects a missing or malformed profile and a bad path", () => {
    expect(validateWriteInput({ profile: "", path: "C:\\Exports\\cookies.txt" })).toMatch(/Choose the Incogniton profile/);
    expect(validateWriteInput({ profile: "not-a-uuid", path: "C:\\Exports\\cookies.txt" })).toMatch(/Choose the Incogniton profile/);
    expect(validateWriteInput({ profile: "44444444-4444-4444-8444-444444444444", path: "relative.txt" })).toMatch(/absolute path/);
  });
});

describe("honest outcome wording", () => {
  it("never claims work before the laptop reports", () => {
    expect(describeResult(task({ status: "pending", result: null }))).toMatch(/Waiting/);
    expect(describeResult(task({ status: "leased", result: null }), "Kashif PC")).toBe("Running on Kashif PC; the lease expires automatically.");
    expect(describeResult(task({ status: "cancelled", result: null }))).toMatch(/Cancelled/);
  });

  it("shows a failure reason when one was stored and says so when it was not", () => {
    expect(describeResult(task({ status: "failed", result: null, error: "Incogniton is not running" }))).toBe("Failed: Incogniton is not running");
    expect(describeResult(task({ status: "failed", result: null, error: null }))).toMatch(/without a stored reason/);
  });

  it("reports a created profile without inventing details", () => {
    expect(describeResult(task({ kind: "profile_create", result: { profile_id: "33333333-3333-4333-8333-333333333333", name: "Fixture" } })))
      .toBe("Created Fixture (33333333…).");
    expect(describeResult(task({ kind: "profile_create", result: {} }))).toMatch(/without a profile id/);
  });

  it("reports counts for the preset snapshot", () => {
    expect(describeResult(base)).toBe("7 profile(s), 2 group(s), 1 open.");
    expect(describeResult(task({ result: { profiles: null, groups: 2 } }))).toMatch(/without counts/);
  });

  it("reports cookie and proxy counts with a short redacted sample", () => {
    expect(describeResult(task({ kind: "cookie_import", result: { entries: 12, with_credentials: 12, domains: 4, sample: [".nextdoor.com", ".example.com"] } })))
      .toBe("12 cookie(s), 12 with credentials · .nextdoor.com, .example.com.");
    expect(describeResult(task({ kind: "proxy_import", result: { entries: 2, with_credentials: 1, sample: ["1.2.3.4:8080"] } })))
      .toBe("2 proxy entry(ies), 1 with credentials · 1.2.3.4:8080.");
    expect(describeResult(task({ kind: "cookie_import", result: { entries: null } }))).toMatch(/without a count/);
  });

  it("reports write outcomes for one named profile and never a secret", () => {
    const target = "44444444-4444-4444-8444-444444444444";
    const nameOf = (id: string) => (id === target ? "ND 001" : undefined);
    expect(describeResult(task({ kind: "cookie_write", payload: { profile_id: target }, result: { entries: 12, written: 12, replaced: true } }), undefined, nameOf))
      .toBe("Imported 12 cookie(s) into ND 001, after clearing existing cookies.");
    expect(describeResult(task({ kind: "cookie_write", payload: { profile_id: target }, result: { entries: 12, written: 12, replaced: false } }), undefined, nameOf))
      .toBe("Imported 12 cookie(s) into ND 001, added alongside existing cookies.");
    expect(describeResult(task({ kind: "cookie_write", payload: { profile_id: target }, result: { entries: 12, written: 12, replaced: false } })))
      .toBe("Imported 12 cookie(s) into the chosen profile, added alongside existing cookies.");
    expect(describeResult(task({ kind: "cookie_write", payload: { profile_id: target }, result: { entries: 12, written: null } }), undefined, nameOf)).toMatch(/without a cookie count/);
    expect(describeResult(task({ kind: "proxy_write", payload: { profile_id: target }, result: { entries: 2, applied: "1.2.3.4:1080" } }), undefined, nameOf))
      .toBe("Proxy 1.2.3.4:1080 applied to ND 001. Username and password are never stored here.");
    expect(describeResult(task({ kind: "proxy_write", payload: { profile_id: target }, result: { entries: 2, applied: null } }), undefined, nameOf)).toMatch(/without a proxy confirmation/);
  });
});
