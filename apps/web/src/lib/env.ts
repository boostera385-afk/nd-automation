export function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || url.includes("YOUR_PROJECT") || key.startsWith("YOUR_")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) return null;
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) return null;
    const expected = process.env.SUPABASE_EXPECTED_PROJECT_REF?.trim();
    if (expected && (!/^[a-z0-9]{20}$/.test(expected) || parsed.hostname !== `${expected}.supabase.co` || parsed.port)) return null;
    if (key.startsWith("sb_secret_")) return null;
    if (key.split(".").length === 3) {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()) as { role?: string; ref?: string };
      if (payload.role !== "anon") return null;
      if (expected && payload.ref !== expected) return null;
    } else if (!key.startsWith("sb_publishable_")) return null;
    return { url, key };
  } catch { return null; }
}

export function appUrl(): string {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("APP_URL must use HTTPS, except on localhost.");
  return url.origin;
}
