"use client";

import { useActionState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { FormState } from "@/app/actions/auth";
import { WorkspaceField } from "./workspace-context";

export function ActionForm({ action, children, label, className = "form-grid", secondary = false }: {
  action: (previous: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode; label: string; className?: string; secondary?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className={className}>
    <WorkspaceField />
    {children}
    {state.error && <p className="notice error" role="alert">{state.error}</p>}
    {state.success && <p className="notice success" role="status">{state.success}</p>}
    <button type="submit" className={secondary ? "button secondary" : "button"} disabled={pending} aria-busy={pending}>{pending ? <><LoaderCircle className="spin" size={15} aria-hidden /> Saving…</> : label}</button>
  </form>;
}
