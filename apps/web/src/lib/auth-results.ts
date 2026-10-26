// Turns Supabase Auth results into user-facing messages. Kept pure so the rules can be tested.
// Sign-up and resend answers are deliberately neutral about whether an email is already registered:
// Supabase hides that on purpose, and a different answer would let anyone probe which addresses have accounts.

export type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined;

const rateLimited = (error: AuthErrorLike) =>
  error?.status === 429 || ["over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit"].includes(error?.code ?? "");

export const SIGNUP_CHECK_EMAIL = "Check your inbox to verify your email. No email after a few minutes? You may already have an account: sign in, or reset your password. New accounts cannot see existing customer records.";
export const RESEND_NEUTRAL = "If that address has an account waiting for verification, a new link is on its way. Check your spam folder too.";

export function signUpFailure(error: AuthErrorLike): string {
  if (rateLimited(error)) return "Too many verification emails were requested. Wait a few minutes, then try again.";
  switch (error?.code) {
    case "weak_password": return "That password is too easy to guess. Choose a longer, less common one.";
    case "email_address_invalid": return "That email address cannot be used. Check it and try again.";
    case "signup_disabled": return "New sign-ups are closed right now. Contact your workspace administrator.";
    default: return "Sign-up could not be completed. Check the email and password requirements, or try again later.";
  }
}

export function signInFailure(error: AuthErrorLike): { message: string; needsVerification: boolean } {
  if (error?.code === "email_not_confirmed") {
    return { message: "Your email is not verified yet. Open the verification link we sent, or request a new one below.", needsVerification: true };
  }
  if (rateLimited(error)) return { message: "Too many attempts. Wait a few minutes, then try again.", needsVerification: false };
  return { message: "Sign-in failed. Check your email and password.", needsVerification: false };
}

export function resendFailure(error: AuthErrorLike): string {
  return rateLimited(error) ? "A verification email was requested very recently. Wait a few minutes, then try again." : "A new verification email could not be requested. Try again later.";
}

// Email links open /auth/confirm, which asks for one click before using the one-time token, so mail scanners that
// pre-open links cannot use it up. The destination is derived from the link type, never from a URL parameter.
export const CONFIRM_TYPES = ["email", "signup", "recovery", "invite", "magiclink", "email_change"] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export function confirmDestination(type: ConfirmType): "/dashboard" | "/reset-password" {
  return type === "recovery" ? "/reset-password" : "/dashboard";
}
