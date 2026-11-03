import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/app/actions/automation-tasks", () => ({ enqueueBrowserTask: vi.fn() }));
import { ComputerControls } from "@/components/computer-controls";
import { LocalHelperField } from "@/components/local-helper-field";
import { hasActiveSession } from "@/lib/active-session";

const helper = { id: "11111111-1111-4111-8111-111111111111", name: "My computer", enabled: true };

it("uses only fixed launch links with no secrets, profile IDs, arguments or callbacks", () => {
  const html = renderToStaticMarkup(<ComputerControls workers={[]} activeSession={false} available />);
  expect(html).toContain('href="nd-automation://open-incogniton"');
  expect(html).toContain('href="nd-automation://start-profile-helper"');
  expect(html).toContain("sign in from any computer");
  expect(html).toContain("Sign-in alone does not connect a helper");
  expect(html).not.toContain("name=\"worker\"");
  expect(html).not.toContain("http://127.0.0.1");
  expect(html).not.toContain("worker_token");
});
it("hides helper selection for one helper without dropping the exact scoped ID", () => {
  const html = renderToStaticMarkup(<LocalHelperField helpers={[helper]} />);
  expect(html).toContain(`type="hidden" name="worker" value="${helper.id}"`);
  expect(html).not.toContain("<select");
});
it("requires an explicit selection with several helpers instead of assuming this computer", () => {
  const html = renderToStaticMarkup(<LocalHelperField helpers={[helper, { ...helper, id: "other", name: "Other computer" }]} />);
  expect(html).toContain('<select name="worker" required="">');
  expect(html).toContain('value="" disabled="" selected=""');
});
it("queues only explicit read-only detection and retains workspace/session guards", () => {
  const html = renderToStaticMarkup(<ComputerControls workers={[helper]} activeSession available />);
  expect(html).toContain('name="workspaceContext"');
  expect(html).toContain('name="kind" value="inventory_scan"');
  expect(html).toContain('name="confirmed" value="on"');
  expect(html).toContain("Detect profiles</button>");
  expect(html).not.toContain("post_edit");
  expect(html).toContain("it may be on another computer");
});
it("disables detection without an active session and hides unavailable/revoked targets", () => {
  const html = renderToStaticMarkup(<ComputerControls workers={[helper]} activeSession={false} available />);
  expect(html).toContain('disabled="">Detect profiles</button>');
  for (const props of [{ workers: [{ ...helper, enabled: false }], available: true }, { workers: [helper], available: false }]) {
    const unavailable = renderToStaticMarkup(<ComputerControls {...props} activeSession />);
    expect(unavailable).not.toContain('name="kind"');
  }
});
it("fails closed on paused, expired, invalid and future sessions", () => {
  const now = Date.parse("2026-11-03T15:00:00Z");
  expect(hasActiveSession({ status: "active", started_at: "2026-11-03T14:00:00Z" }, now)).toBe(true);
  for (const session of [null, { status: "paused", started_at: "2026-11-03T14:00:00Z" },
    { status: "active", started_at: "2026-11-03T05:00:00Z" }, { status: "active", started_at: "2026-11-03T16:00:00Z" },
    { status: "active", started_at: "invalid" }]) expect(hasActiveSession(session, now)).toBe(false);
});
