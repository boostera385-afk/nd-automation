import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicConfig } from "@/lib/env";

const current = "xtefjnfdjnxwrpkoydaj";
const old = "tyczcognqypqxrvkbmrk";
const fakeKey = "sb_publishable_fixture_not_a_real_key";
const legacy = (role: string, ref: string) => `header.${Buffer.from(JSON.stringify({ role, ref })).toString("base64url")}.signature`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${current}.supabase.co`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", fakeKey);
  vi.stubEnv("SUPABASE_EXPECTED_PROJECT_REF", current);
});
afterEach(() => vi.unstubAllEnvs());

describe("Supabase deployment target guard", () => {
  it("accepts an explicitly matching hosted target and publishable key", () => {
    expect(publicConfig()).toEqual({ url: `https://${current}.supabase.co`, key: fakeKey });
  });
  it("blocks the superseded backend during a project handover", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${old}.supabase.co`);
    expect(publicConfig()).toBeNull();
  });
  it.each(["sbp_fixture_management_access_token", "sb_secret_fixture_not_for_clients", "service_role", "YOUR_PUBLISHABLE_KEY", ""])("rejects management/secret/placeholder key %s", (key) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    expect(publicConfig()).toBeNull();
  });
  it("requires the same project ref for legacy anon JWT keys", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", legacy("anon", old)); expect(publicConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", legacy("anon", current)); expect(publicConfig()).not.toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", legacy("service_role", current)); expect(publicConfig()).toBeNull();
  });
  it.each([`https://${current}.supabase.co.attacker.test`, `https://user:password@${current}.supabase.co`, `https://${current}.supabase.co/rest/v1`, `https://${current}.supabase.co?key=bad`, `https://${current}.supabase.co#fragment`, `http://${current}.supabase.co`, `https://${current}.supabase.co:444`])("rejects unsafe or mismatched API origin %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url); expect(publicConfig()).toBeNull();
  });
  it("refuses invalid project pins", () => {
    vi.stubEnv("SUPABASE_EXPECTED_PROJECT_REF", "bad-ref"); expect(publicConfig()).toBeNull();
  });
  it("preserves explicitly unpinned local development", () => {
    vi.stubEnv("SUPABASE_EXPECTED_PROJECT_REF", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(publicConfig()).not.toBeNull();
  });
});
