"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { ArrowRight, CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle, Mail, LockKeyhole } from "lucide-react";
import { authenticate } from "@/app/actions/auth";

export function AuthForm({ mode }: { mode: "login" | "signup" | "forgot" | "reset" }) {
  const [state, action, pending] = useActionState(authenticate, {});
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const status = useRef<HTMLDivElement>(null);
  const [resending, startResend] = useTransition();
  const id = useId();
  const resend = () => { const data = new FormData(); data.set("mode", "resend"); data.set("email", email); startResend(() => action(data)); };
  const labels = { login: "Sign in to workspace", signup: "Create account", forgot: "Send reset link", reset: "Save new password" };
  const pendingLabels = { login: "Signing you in…", signup: "Creating your account…", forgot: "Requesting your link…", reset: "Updating your password…" };

  useEffect(() => { if (state.error || state.success) status.current?.focus(); }, [state]);

  return <>
    <form action={action} className="auth-form" aria-busy={pending}>
      <input type="hidden" name="mode" value={mode} />
      {mode !== "reset" && <div className="auth-field"><label htmlFor={`${id}-email`}>Work email</label><div className="auth-input-wrap"><Mail size={18} aria-hidden /><input id={`${id}-email`} name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} /></div></div>}
      {mode !== "forgot" && <div className="auth-field"><div className="auth-label-row"><label htmlFor={`${id}-password`}>{mode === "reset" ? "New password" : "Password"}</label>{mode === "login" && <Link href="/forgot-password">Forgot password?</Link>}</div><div className="auth-input-wrap"><LockKeyhole size={18} aria-hidden /><input id={`${id}-password`} name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 12} maxLength={128} required placeholder={mode === "login" ? "Enter your password" : "Create a strong password"} disabled={pending} aria-describedby={mode !== "login" ? `${id}-hint` : undefined} onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))} onBlur={() => setCapsLock(false)} /><button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{mode !== "login" && <span id={`${id}-hint`} className="auth-field-hint">Use at least 12 characters. Password managers are welcome.</span>}{capsLock && <span className="auth-caps" role="status">Caps Lock is on.</span>}</div>}
      {(state.error || state.success) && <div ref={status} tabIndex={-1} className={`auth-feedback ${state.error ? "is-error" : "is-success"}`} role={state.error ? "alert" : "status"}>{state.error ? <CircleAlert size={18} aria-hidden /> : <CircleCheck size={18} aria-hidden />}<span>{state.error || state.success}</span></div>}
      {mode === "login" && state.needsVerification && <button type="button" className="auth-secondary" onClick={resend} disabled={pending || resending || !email}>{resending ? "Sending…" : "Send a new verification email"}</button>}
      <button type="submit" className="auth-submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={18} aria-hidden /><span>{pendingLabels[mode]}</span></> : <><span>{labels[mode]}</span><ArrowRight size={18} aria-hidden /></>}</button>
    </form>
    <div className="auth-form-footer">{mode === "login" ? <p>New to ND? <Link href="/signup">Create an account <ArrowRight size={13} aria-hidden /></Link></p> : <Link href="/login">Back to sign in</Link>}</div>
  </>;
}
