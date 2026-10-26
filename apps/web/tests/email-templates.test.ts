import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = (name: string) => fileURLToPath(new URL(`../../../supabase/templates/${name}`, import.meta.url));
const html = (name: string) => readFileSync(dir(`${name}.html`), "utf8");
const linked = { "confirm-signup": "email", "reset-password": "recovery", "magic-link": "magiclink", "invite-user": "invite", "change-email": "email_change" } as const;
const all = [...Object.keys(linked), "reauthentication"];

describe("Supabase email templates", () => {
  it.each(Object.entries(linked))("%s links to the one-click confirm page with a token hash and type %s", (name, type) => {
    const text = html(name);
    expect(text).toContain(`href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}"`);
    expect(text).not.toContain("{{ .ConfirmationURL }}");
  });

  it("shows the code in the re-authentication email and no link", () => {
    const text = html("reauthentication");
    expect(text).toContain("{{ .Token }}");
    expect(text).not.toContain("token_hash");
  });

  it.each(all)("%s is self-contained and email-client safe", (name) => {
    const text = html(name);
    expect(text).not.toMatch(/<script|<img|<link |@import|url\(|javascript:/i);
    expect(text).toContain('role="presentation"');
    expect(text).toContain("prefers-color-scheme: dark");
    expect(text).toContain('lang="en"');
    expect(text).toMatch(/<title>[^<]+<\/title>/);
    expect(text).toMatch(/display:none;max-height:0/);
    for (const placeholder of text.match(/\{\{[^}]*\}\}/g) ?? []) expect(["{{ .SiteURL }}", "{{ .TokenHash }}", "{{ .Email }}", "{{ .NewEmail }}", "{{ .Token }}"]).toContain(placeholder);
  });

  it("has a subject for every template, short enough to display fully", () => {
    const subjects = JSON.parse(readFileSync(dir("subjects.json"), "utf8")) as Record<string, string>;
    expect(Object.keys(subjects).sort()).toEqual([...all].sort());
    for (const subject of Object.values(subjects)) expect(subject.length).toBeLessThanOrEqual(60);
  });
});
