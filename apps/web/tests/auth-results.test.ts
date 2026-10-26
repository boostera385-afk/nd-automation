import { describe, expect, it } from "vitest";
import { confirmDestination, CONFIRM_TYPES, RESEND_NEUTRAL, resendFailure, SIGNUP_CHECK_EMAIL, signInFailure, signUpFailure } from "@/lib/auth-results";

describe("sign-up results", () => {
  it("never claims an address is new or taken", () => {
    expect(SIGNUP_CHECK_EMAIL).not.toMatch(/already registered|already exists|new account created/i);
    expect(SIGNUP_CHECK_EMAIL).toMatch(/already have an account/i);
    expect(RESEND_NEUTRAL).toMatch(/^If that address/);
  });

  it("maps known failures to specific, safe messages", () => {
    expect(signUpFailure({ code: "weak_password" })).toMatch(/easy to guess/);
    expect(signUpFailure({ code: "over_email_send_rate_limit" })).toMatch(/Too many verification emails/);
    expect(signUpFailure({ status: 429 })).toMatch(/Too many verification emails/);
    expect(signUpFailure({ code: "email_address_invalid" })).toMatch(/cannot be used/);
    expect(signUpFailure({ code: "signup_disabled" })).toMatch(/closed/);
    expect(signUpFailure({ code: "something_new", message: "internal detail" })).not.toContain("internal detail");
    expect(signUpFailure(null)).toMatch(/could not be completed/);
  });
});

describe("sign-in results", () => {
  it("offers a resend only when the email is genuinely unverified", () => {
    expect(signInFailure({ code: "email_not_confirmed" })).toMatchObject({ needsVerification: true });
    expect(signInFailure({ code: "invalid_credentials" })).toMatchObject({ needsVerification: false });
    expect(signInFailure(null)).toMatchObject({ needsVerification: false });
  });

  it("gives the same wording for a wrong password and an unknown account", () => {
    expect(signInFailure({ code: "invalid_credentials" }).message).toBe(signInFailure({ code: "user_not_found" }).message);
  });

  it("reports rate limiting honestly", () => {
    expect(signInFailure({ status: 429 }).message).toMatch(/Too many attempts/);
    expect(resendFailure({ code: "over_email_send_rate_limit" })).toMatch(/very recently/);
    expect(resendFailure({ code: "other" })).toMatch(/could not be requested/);
  });
});

describe("email link destinations", () => {
  it("sends only recovery links to the password page and everything else to the dashboard", () => {
    expect(confirmDestination("recovery")).toBe("/reset-password");
    for (const type of CONFIRM_TYPES.filter((item) => item !== "recovery")) expect(confirmDestination(type)).toBe("/dashboard");
  });
});
