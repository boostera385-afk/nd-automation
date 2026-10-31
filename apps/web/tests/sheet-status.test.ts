import { describe, expect, it } from "vitest";
import { buildSyncView, classifyStatus, parseSyncEndpoint, sheetResponseSchema, validPostUrl, type ExistingPublication, type SheetRow } from "@/lib/sheet-status";

const link = (id: string) => `https://nextdoor.com/p/${id}`;
const row = (rowNumber: number, overrides: Partial<SheetRow> = {}): SheetRow => ({ rowNumber, profileName: `Profile ${rowNumber}`, title: `Post number ${rowNumber}`, postLink: link(`AAA${rowNumber}`), status: "Posted", ...overrides });

describe("classifyStatus uses the values the Sheet automation really writes", () => {
  it("recognises posted with and without a usable link", () => {
    expect(classifyStatus("Posted", link("abc123"))).toBe("posted");
    expect(classifyStatus("Posted", "")).toBe("posted_no_link");
    expect(classifyStatus("Posted | Link: No link extracted", "")).toBe("posted_no_link");
    expect(classifyStatus("Posted", "https://example.com/p/abc")).toBe("posted_bad_link");
  });

  it("recognises failures, retries, stops, claims and the empty queue", () => {
    expect(classifyStatus("Failed: Locator.click: Timeout 30000ms exceeded.", "")).toBe("failed");
    expect(classifyStatus("Failed (Timeout/Retryable): Failed to start profile", "")).toBe("failed_retryable");
    expect(classifyStatus("Failed (Stopped)", "")).toBe("stopped");
    expect(classifyStatus("CLAIMED", "")).toBe("claimed");
    expect(classifyStatus("", "")).toBe("pending");
    expect(classifyStatus("pending", "")).toBe("pending");
    expect(classifyStatus("Imported 51 cookies", "")).toBe("other");
  });

  it("understands the verification results people write: Alive, Post Deleted from ND, Proxy Issue", () => {
    expect(classifyStatus("Alive", link("abc123"))).toBe("alive");
    expect(classifyStatus("alive", link("abc123"))).toBe("alive");
    expect(classifyStatus("Alive", "")).toBe("posted_no_link");
    for (const text of ["Post Deleted from ND", "Post Delete from ND", "Deleted", "post removed from nd"]) expect(classifyStatus(text, link("abc123"))).toBe("deleted");
    for (const text of ["Proxy Issue", "proxy issue - recheck"]) expect(classifyStatus(text, link("abc123"))).toBe("proxy_issue");
  });

  it("never mistakes an automation error that mentions a proxy or a deletion for a check result", () => {
    expect(classifyStatus("Failed: Failed to update proxy: timeout", "")).toBe("failed");
    expect(classifyStatus("Failed (Timeout/Retryable): proxy unreachable", "")).toBe("failed_retryable");
    expect(classifyStatus("Failed: could not delete the draft", "")).toBe("failed");
  });

  it("does not treat a failed row that has a link as posted", () => {
    expect(classifyStatus("Failed: something", link("abc123"))).toBe("failed");
  });

  it("is case and spacing tolerant", () => {
    expect(classifyStatus("  POSTED ", link("abc123"))).toBe("posted");
  });
});

describe("validPostUrl", () => {
  it("normalises exact share links and rejects everything else", () => {
    expect(validPostUrl(`${link("abc123")}/?utm=1#x`)).toBe(link("abc123"));
    expect(validPostUrl("")).toBeNull();
    expect(validPostUrl("No link extracted")).toBeNull();
    expect(validPostUrl("http://nextdoor.com/p/abc123")).toBeNull();
    expect(validPostUrl("https://evil.example/p/abc123")).toBeNull();
  });
});

describe("buildSyncView", () => {
  const known = new Map<string, ExistingPublication>([[link("AAA3"), { id: "x", visibility: "live" }]]);
  const rows = [
    row(2), row(3), row(4, { postLink: link("AAA2") }),
    row(5, { status: "Posted", postLink: "" }),
    row(6, { status: "Failed: Locator.click: Timeout", postLink: "" }),
    row(7, { status: "", postLink: "" }),
    row(8, { postLink: link("AAA2") }),
  ];

  it("counts every status and keeps pending rows out of the attention list", () => {
    const view = buildSyncView(rows, new Map());
    expect(view.total).toBe(7);
    expect(view.counts.posted).toBe(4);
    expect(view.counts.posted_no_link).toBe(1);
    expect(view.counts.failed).toBe(1);
    expect(view.counts.pending).toBe(1);
    expect(view.attention.map((item) => item.rowNumber)).toEqual([5, 6]);
  });

  it("imports only new, usable, de-duplicated posted links and never invents a date", () => {
    const view = buildSyncView(rows, known);
    expect(view.inDashboard).toBe(1);
    expect(view.crossCheck).toEqual({ live: 1 });
    expect(view.duplicateLinks).toBe(2);
    expect(view.importable.map((item) => item.url)).toEqual([link("AAA2")]);
    expect(view.importable.every((item) => item.published_at === null)).toBe(true);
  });

  it("imports Alive rows like posted ones, but deleted and proxy-issue rows need attention instead", () => {
    const view = buildSyncView([row(2, { status: "Alive" }), row(3, { status: "Post Deleted from ND" }), row(4, { status: "Proxy Issue" })], new Map());
    expect(view.importable.map((item) => item.url)).toEqual([link("AAA2")]);
    expect(view.attention.map((item) => [item.rowNumber, item.kind])).toEqual([[3, "deleted"], [4, "proxy_issue"]]);
    expect(view.counts).toMatchObject({ alive: 1, deleted: 1, proxy_issue: 1 });
  });

  it("falls back to honest labels when the title or profile is missing", () => {
    const view = buildSyncView([row(9, { title: "  ", profileName: "" })], new Map());
    expect(view.importable[0].title).toBe("Untitled post (sheet row 9)");
    expect(view.importable[0].account_label).toBe("Unknown account");
  });

  it("caps long titles and the batch size", () => {
    const many = Array.from({ length: 350 }, (_, i) => row(i + 2, { postLink: link(`ZZ${i}abc`), title: "x".repeat(400).slice(0, 300) }));
    const view = buildSyncView(many, new Map());
    expect(view.importableTotal).toBe(350);
    expect(view.importable).toHaveLength(300);
    expect(view.importable[0].title.length).toBeLessThanOrEqual(200);
  });

  it("groups importable posts by profile and tells known, ambiguous and new profiles apart", () => {
    const rows = [row(2, { profileName: "Alice" }), row(3, { profileName: "Alice" }), row(4, { profileName: "Bob" }), row(5, { profileName: "Cara" }), row(6, { profileName: "Dan" })];
    const known = new Map<string, Set<string>>([["Alice", new Set(["c1"])], ["Bob", new Set(["c1", "c2"])]]);
    const view = buildSyncView(rows, new Map(), known);
    expect(view.profiles).toEqual([
      { profile: "Alice", posts: 2, knownCustomerIds: ["c1"] },
      { profile: "Bob", posts: 1, knownCustomerIds: ["c1", "c2"] },
      { profile: "Cara", posts: 1, knownCustomerIds: [] },
      { profile: "Dan", posts: 1, knownCustomerIds: [] },
    ]);
  });

  it("does not list profiles whose posts are all already in the dashboard", () => {
    const view = buildSyncView([row(2, { profileName: "Alice" })], new Map([[link("AAA2"), { id: "x", visibility: "live" as const }]]));
    expect(view.profiles).toEqual([]);
  });
});

describe("sheetResponseSchema is strict", () => {
  const ok = { ok: true, sheet: "Auto Posting", fetchedAt: "2026-10-27T00:00:00.000Z", truncated: false, rows: [{ rowNumber: 2, profileName: "A", title: "T", postLink: "", status: "Posted" }] };

  it("accepts the expected shape", () => {
    expect(sheetResponseSchema.safeParse(ok).success).toBe(true);
    expect(sheetResponseSchema.safeParse({ ok: false, error: "unauthorized" }).success).toBe(true);
  });

  it("rejects a response carrying credential-like fields", () => {
    const leaky = { ...ok, rows: [{ ...ok.rows[0], Password: "secret", Email: "a@b.c" }] };
    expect(sheetResponseSchema.safeParse(leaky).success).toBe(false);
  });

  it("rejects an unknown tab and malformed rows", () => {
    expect(sheetResponseSchema.safeParse({ ...ok, sheet: "ND Acc Creation" }).success).toBe(false);
    expect(sheetResponseSchema.safeParse({ ...ok, rows: [{ rowNumber: 1, profileName: "", title: "", postLink: "", status: "" }] }).success).toBe(false);
  });
});

describe("parseSyncEndpoint", () => {
  it("accepts an Apps Script web app URL", () => {
    expect(parseSyncEndpoint("https://script.google.com/macros/s/AKfycbxABC_def-123/exec")?.pathname).toBe("/macros/s/AKfycbxABC_def-123/exec");
    expect(parseSyncEndpoint("https://script.google.com/a/macros/example.com/s/AKfycbx123/exec")).not.toBeNull();
  });

  it("drops query strings and refuses anything that could send the secret elsewhere", () => {
    expect(parseSyncEndpoint("https://script.google.com/macros/s/AKfy123/exec?x=1")?.search).toBe("");
    for (const bad of ["", "http://script.google.com/macros/s/AKfy123/exec", "https://evil.example/macros/s/AKfy123/exec", "https://script.google.com.evil.example/macros/s/AKfy123/exec", "https://user:pw@script.google.com/macros/s/AKfy123/exec", "https://script.google.com:8443/macros/s/AKfy123/exec", "https://script.google.com/macros/s/AKfy123/dev", "not a url"]) {
      expect(parseSyncEndpoint(bad)).toBeNull();
    }
    expect(parseSyncEndpoint(undefined)).toBeNull();
  });
});
