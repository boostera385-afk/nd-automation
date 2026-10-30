import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspace: vi.fn(), sheetSyncConfigured: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    <a href={href} className={className}>{children}</a>,
}));
vi.mock("@/lib/data", () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock("@/lib/sheet-sync", () => ({ sheetSyncConfigured: mocks.sheetSyncConfigured }));

import SetupGuide from "@/app/dashboard/settings/guide/page";
import Settings from "@/app/dashboard/settings/page";

const organization = { id: "11111111-1111-4111-8111-111111111111", name: "Fixture workspace", time_zone: "America/Los_Angeles" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspace.mockResolvedValue({ organization, membership: { role: "owner" }, isStaff: true });
  mocks.sheetSyncConfigured.mockReturnValue(true);
});

describe("first-time setup guide", () => {
  it("renders all four colored phases with their setup and daily-use steps", async () => {
    const html = renderToStaticMarkup(await SetupGuide());
    for (const phase of ["PHASE 1 · DO THIS ONCE", "PHASE 2 · FUDGE INTAKE", "PHASE 3 · ND DASHBOARD AUTOMATIONS", "PHASE 4 · EVERY WORKING DAY"]) {
      expect(html).toContain(phase);
    }
    expect(html).toContain("Pair your laptop / worker once");
    expect(html).toContain("Map the exact profile, not a guessed name");
    expect(html).toContain("Sync the Master Sheet");
    expect(html).toContain("Confirm a monitoring batch once");
    expect(html).toContain("guide-tone-blue");
    expect(html).toContain("guide-tone-violet");
    expect(html).toContain("guide-tone-green");
    expect(html).toContain("guide-tone-amber");
  });

  it("states the Fudge upload gate and the read-only receipt limit plainly", async () => {
    const html = renderToStaticMarkup(await SetupGuide());
    expect(html).toContain("Upload release is off in this Fudge build");
    expect(html).toContain("It shows received-record and revision counts");
    expect(html).toContain("An empty backend count does not mean the local Fudge library is empty");
    expect(html).toContain('href="/dashboard/fudge"');
  });

  it("covers the account-disabled stop and refuses evasion", async () => {
    const html = renderToStaticMarkup(await SetupGuide());
    expect(html).toContain("Account disabled / needs review");
    expect(html).toContain("Never use another profile or technique to evade a suspension.");
    expect(html).toContain("Login required");
    expect(html).toContain("Proxy issue");
    expect(html).toContain("Profile busy");
  });

  it("separates desktop-only work and keeps irreversible actions gated", async () => {
    const html = renderToStaticMarkup(await SetupGuide());
    expect(html).toContain("STILL DESKTOP OR GATED");
    expect(html).toContain("Auto Posting, Auto Listing, Incogniton profile creation");
    expect(html).toContain("Dashboard publishing and listings, scheduling, account creation, automatic Sheet writeback");
    expect(html).toContain("Desktop only");
    expect(html).toContain("Irreversible actions stay off");
    expect(html).not.toContain("Start posting");
  });

  it("is linked prominently from Settings", async () => {
    const html = renderToStaticMarkup(await Settings());
    expect(html).toContain("Open the colored setup &amp; how-to guide");
    expect(html).toContain('href="/dashboard/settings/guide"');
  });
});
