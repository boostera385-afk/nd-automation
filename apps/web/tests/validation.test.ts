import { describe, expect, it, afterEach, vi } from "vitest";
import { previewCsv } from "@/lib/imports";
import { postUrlSchema, safeAuthNext, safeCsvCell } from "@/lib/validation";
import { publicConfig } from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("reviewed CSV imports", () => {
  it("accepts authorized record fields with offset timestamps", () => {
    const result = previewCsv('title,url,account_label,published_at\n"Customer, post",https://nextdoor.com/p/example,Owned business,2026-10-25T10:00:00-07:00');
    expect(result.errors).toEqual([]);
    expect(result.rows[0].title).toBe("Customer, post");
  });
  it("does not invent unknown dates", () => {
    expect(previewCsv("title,url,account_label\nA real post,https://nextdoor.com/p/example,Owned").rows[0].published_at).toBeNull();
  });
  it.each(["Cookies", "password", "proxy", "Status", "unknown_field"])("rejects unexpected/sensitive header %s", (header) => {
    expect(previewCsv(`title,url,account_label,${header}\nA post,https://nextdoor.com/p/x,Owned,value`).errors.length).toBeGreaterThan(0);
  });
  it("rejects dates without an explicit offset", () => {
    expect(previewCsv("title,url,account_label,published_at\nA post,https://nextdoor.com/p/x,Owned,2026-10-25T10:00:00").errors.length).toBe(1);
  });
  it("detects duplicate canonical post links", () => {
    const result = previewCsv("title,url,account_label\nA post,https://nextdoor.com/p/x?track=1,Owned\nA post,https://nextdoor.com/p/x/,Owned");
    expect(result.errors[0]).toContain("duplicate");
  });
  it("limits import size and row count", () => {
    expect(previewCsv("x".repeat(513 * 1024)).rows).toEqual([]);
    expect(previewCsv("title,url,account_label\n" + Array.from({ length: 101 }, (_, i) => `Post ${i},https://nextdoor.com/p/${i},Owned`).join("\n")).errors[0]).toContain("100");
  });
});

describe("URLs and exported cells", () => {
  it.each(["http://nextdoor.com/p/a", "https://nextdoor.com.evil.test/p/a", "https://user:pass@nextdoor.com/p/a", "javascript:alert(1)", "https://nextdoor.com/news_feed/", "https://nextdoor.com/profile/person"])("rejects unsafe/non-post URL %s", (url) => expect(postUrlSchema.safeParse(url).success).toBe(false));
  it.each(["", "No link extracted", "not a url", "nextdoor.com/p/abc"])("fails validation instead of throwing on non-URL text %j", (text) => {
    expect(() => postUrlSchema.safeParse(text)).not.toThrow();
    expect(postUrlSchema.safeParse(text).success).toBe(false);
  });
  it("strips tracking parameters and fragments", () => expect(postUrlSchema.parse("https://nextdoor.com/p/a?tracking=1#comments")).toBe("https://nextdoor.com/p/a"));
  it.each(["=1+1", "+SUM(A1)", "-2+2", "@formula", "  =HYPERLINK(1)", "\t=1"])("neutralizes CSV formula input %s", (value) => expect(safeCsvCell(value).startsWith('"\'')).toBe(true));
  it("escapes quotes", () => expect(safeCsvCell('a"b')).toBe('"a""b"'));
  it("rejects external and protocol-relative auth redirects", () => {
    expect(safeAuthNext("//evil.test")).toBe("/dashboard");
    expect(safeAuthNext("https://evil.test")).toBe("/dashboard");
    expect(safeAuthNext("/reset-password")).toBe("/reset-password");
  });
});

describe("public Supabase configuration", () => {
  it("treats placeholders as setup required", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://YOUR_PROJECT.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "YOUR_KEY");
    expect(publicConfig()).toBeNull();
  });
  it("refuses a secret key in a public variable", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_not-a-real-key");
    expect(publicConfig()).toBeNull();
  });
  it("refuses service-role JWTs", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x`);
    expect(publicConfig()).toBeNull();
  });
});
