import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = (name: string) => fileURLToPath(new URL(`../../../supabase/templates/${name}`, import.meta.url));
const html = (name: string) => readFileSync(dir(`${name}.html`), "utf8");
const linked = { "confirm-signup": "email", "reset-password": "recovery", "magic-link": "magiclink", "invite-user": "invite", "change-email": "email_change" } as const;
const all = [...Object.keys(linked), "reauthentication"];

describe("Supabase email templates", () => {
  it("explains shared credentials, separate extension sign-in and no automatic execution", () => {
    const text = html("confirm-signup");
    expect(text).toContain("Fudge + ND Automations");
    expect(text).toContain("no second signup is needed");
    expect(text).toContain("sign in separately");
    expect(text).toContain("does not start collection, uploads or publishing");
    expect(text).toContain("Do not share this link");
    expect(html("reset-password")).toContain("both Fudge and the ND dashboard");
  });
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
