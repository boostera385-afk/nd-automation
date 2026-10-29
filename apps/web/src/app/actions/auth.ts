"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { appUrl, publicConfig } from "@/lib/env";
import { credentialsSchema } from "@/lib/validation";
import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "@/lib/workspace-selection";
import { CONFIRM_TYPES, confirmDestination, RESEND_NEUTRAL, resendFailure, SIGNUP_CHECK_EMAIL, signInFailure, signUpFailure } from "@/lib/auth-results";

export type FormState = { error?: string; success?: string; needsVerification?: boolean };

export async function authenticate(_previous: FormState, form: FormData): Promise<FormState> {
  if (!publicConfig()) return { error: "Account access is temporarily unavailable. Please contact your workspace administrator." };
  const mode = z.enum(["login", "signup", "forgot", "reset", "resend"]).safeParse(form.get("mode"));
  if (!mode.success) return { error: "Invalid request." };
  const db = await createClient();
  if (mode.data === "forgot" || mode.data === "resend") {
    const email = z.email().max(254).safeParse(form.get("email"));
    if (!email.success) return { error: "Enter a valid email address." };
    if (mode.data === "resend") {
      const { error } = await db.auth.resend({ type: "signup", email: email.data, options: { emailRedirectTo: `${appUrl()}/auth/callback` } });
      return error ? { error: resendFailure(error) } : { success: RESEND_NEUTRAL };
    }
    const { error } = await db.auth.resetPasswordForEmail(email.data, { redirectTo: `${appUrl()}/auth/callback?next=/reset-password` });
    if (error) return { error: "Reset email could not be requested. Try again later." };
    return { success: "If the address is registered, a reset link will arrive shortly." };
  }
  if (mode.data === "reset") {
    const password = credentialsSchema.shape.password.safeParse(form.get("password"));
    if (!password.success) return { error: password.error.issues[0].message };
    const { data } = await db.auth.getUser();
    if (!data.user) return { error: "Open the valid reset link from your email first." };
    const { error } = await db.auth.updateUser({ password: password.data });
    if (error) return { error: "Password update failed. Request a new reset link." };
    redirect("/dashboard");
  }
  const input = (mode.data === "signup" ? credentialsSchema : credentialsSchema.extend({ password: z.string().min(1).max(128) })).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success) return { error: input.error.issues[0].message };
  if (mode.data === "signup") {
    // Supabase answers "success" for an address that is already registered, so the reply stays neutral either way.
    const { error } = await db.auth.signUp({ ...input.data, options: { emailRedirectTo: `${appUrl()}/auth/callback` } });
    if (error) return { error: signUpFailure(error) };
    return { success: SIGNUP_CHECK_EMAIL };
  }
  const { error } = await db.auth.signInWithPassword(input.data);
  if (error) {
    const failure = signInFailure(error);
    return { error: failure.message, needsVerification: failure.needsVerification };
  }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// Runs only when the person clicks the button on /auth/confirm, so a mail scanner opening the link cannot use the token.
export async function confirmEmailLink(_previous: FormState, form: FormData): Promise<FormState> {
  if (!publicConfig()) return { error: "Account access is temporarily unavailable. Please contact your workspace administrator." };
  const input = z.object({ token_hash: z.string().min(8).max(512), type: z.enum(CONFIRM_TYPES) }).safeParse({ token_hash: form.get("token_hash"), type: form.get("type") });
  if (!input.success) return { error: "This link is not valid. Request a new one from the sign-in page." };
  const db = await createClient();
  const type = input.data.type === "signup" ? "email" : input.data.type;
  const { error } = await db.auth.verifyOtp({ token_hash: input.data.token_hash, type });
  if (error) return { error: "This link has expired or was already used. Request a new one from the sign-in page." };
  revalidatePath("/", "layout");
  redirect(confirmDestination(input.data.type));
}

export async function signOut() {
  (await cookies()).delete(WORKSPACE_COOKIE);
  if (publicConfig()) { const db = await createClient(); await db.auth.signOut(); }
  revalidatePath("/", "layout");
  redirect("/login");
}
