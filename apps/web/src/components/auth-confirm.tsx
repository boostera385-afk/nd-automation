"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, CircleAlert, LoaderCircle, MailCheck } from "lucide-react";
import { confirmEmailLink } from "@/app/actions/auth";
import type { ConfirmType } from "@/lib/auth-results";

const copy: Record<string, { button: string; pending: string }> = {
  recovery: { button: "Continue to set a new password", pending: "Checking your link…" },
  default: { button: "Confirm and continue", pending: "Confirming…" },
};

export function AuthConfirm({ tokenHash, type }: { tokenHash: string; type: ConfirmType }) {
  const [state, action, pending] = useActionState(confirmEmailLink, {});
  const labels = copy[type] ?? copy.default;
  return <form action={action} className="auth-form" aria-busy={pending}>
    <input type="hidden" name="token_hash" value={tokenHash} />
    <input type="hidden" name="type" value={type} />
    <div className="auth-feedback is-success" role="status"><MailCheck size={18} aria-hidden /><span>One quick step. Press the button to finish. This protects your link from being used up by email scanners.</span></div>
    {state.error && <div className="auth-feedback is-error" role="alert"><CircleAlert size={18} aria-hidden /><span>{state.error}</span></div>}
    <button type="submit" className="auth-submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={18} aria-hidden /><span>{labels.pending}</span></> : <><span>{labels.button}</span><ArrowRight size={18} aria-hidden /></>}</button>
    {state.error && <div className="auth-form-footer"><Link href="/login">Back to sign in</Link></div>}
  </form>;
}
