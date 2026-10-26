import { z } from "zod";
import type { Visibility } from "./validation";

// Mirrors private_reporting.check_outcome_info in supabase/migrations/202610270001_post_checks_and_notifications.sql.
// tests/checks.test.ts runs the real SQL and fails if the two ever drift apart.
export const CHECK_OUTCOMES = ["alive", "deleted_from_nd", "unavailable", "proxy_issue", "login_required", "verification_required", "network_error", "profile_error", "needs_review"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];
export type CheckTone = "positive" | "negative" | "attention";

export const checkOutcomeSchema = z.enum(CHECK_OUTCOMES, "Choose what you found.");

// True when the database has not had the post-checks migration applied yet. The dashboard then keeps working
// and tells staff what to do, instead of failing the whole page.
export function isMissingSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "") || /schema cache|does not exist/i.test(error.message ?? "");
}

export type OutcomeInfo = { label: string; tone: CheckTone; headline: string; visibility: Visibility | null; hint: string; primary: boolean };

export const checkOutcomes: Record<CheckOutcome, OutcomeInfo> = {
  alive: { label: "Alive", tone: "positive", headline: "Post is alive", visibility: "live", hint: "The post opened and is visible.", primary: true },
  deleted_from_nd: { label: "Removed from Nextdoor", tone: "negative", headline: "Post was removed from Nextdoor", visibility: "confirmed_removed", hint: "Nextdoor showed an explicit removal message. Write what you saw as evidence.", primary: true },
  proxy_issue: { label: "Proxy issue", tone: "attention", headline: "Proxy issue: post could not be checked", visibility: null, hint: "The proxy blocked or broke the check. This says nothing about the post itself.", primary: true },
  unavailable: { label: "Not accessible", tone: "negative", headline: "Post is not accessible", visibility: "unavailable", hint: "The post could not be opened and no removal message was shown.", primary: false },
  login_required: { label: "Login needed", tone: "attention", headline: "Login needed: post could not be checked", visibility: null, hint: "The profile is logged out. Log in, then check again.", primary: false },
  verification_required: { label: "Verification needed", tone: "attention", headline: "Verification needed: post could not be checked", visibility: null, hint: "Nextdoor asked for a captcha, phone or identity check that a person must handle.", primary: false },
  network_error: { label: "Network problem", tone: "attention", headline: "Network problem: post could not be checked", visibility: null, hint: "A connection error stopped the check.", primary: false },
  profile_error: { label: "Profile did not open", tone: "attention", headline: "Browser profile did not open: post could not be checked", visibility: null, hint: "The browser profile would not start.", primary: false },
  needs_review: { label: "Needs review", tone: "attention", headline: "Needs a closer look", visibility: null, hint: "Something looked odd and a person should decide.", primary: false },
};

export const toneLabel: Record<CheckTone, string> = { positive: "Positive", negative: "Negative", attention: "Needs attention" };

export function outcomeInfo(outcome: string | null | undefined): OutcomeInfo | null {
  return outcome && outcome in checkOutcomes ? checkOutcomes[outcome as CheckOutcome] : null;
}

// A post needs another check when it was never checked, its last observation is old, or the last attempt could not be completed.
export function needsCheck(post: { visibility: Visibility; last_check_outcome?: string | null }, stale: boolean): boolean {
  if (post.visibility === "not_checked" || stale) return true;
  const info = outcomeInfo(post.last_check_outcome);
  return info?.tone === "attention";
}
