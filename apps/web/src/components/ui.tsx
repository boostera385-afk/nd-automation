import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { outcomeInfo } from "@/lib/checks";
import type { Visibility } from "@/lib/validation";

export const visibilityLabels: Record<Visibility, string> = { not_checked: "Not checked", live: "Observed live", unavailable: "Unavailable", confirmed_removed: "Confirmed removed", deleted_by_owner: "Deleted by owner", unknown: "Unknown" };

export function Badge({ status }: { status: Visibility }) {
  return <span className={`badge ${status}`}><span className="badge-dot" aria-hidden />{visibilityLabels[status]}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  const info = outcomeInfo(outcome);
  return info ? <span className={`badge tone-${info.tone}`} title={info.headline}><span className="badge-dot" aria-hidden />{info.label}</span> : null;
}

export function PageHeader({ eyebrow = "CUSTOMER REPORTING", title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>{actions && <div className="header-actions">{actions}</div>}</header>;
}

export function StatCard({ label, value, hint, icon: Icon }: { label: string; value: ReactNode; hint: string; icon: LucideIcon }) {
  return <article className="stat-card"><div><span>{label}</span><Icon size={18} aria-hidden /></div><strong>{value}</strong><small>{hint}</small></article>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Inbox size={26} aria-hidden /></span><h3>{title}</h3><p>{children}</p></div>;
}

export function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><h2>{title}</h2>{hint && <span className="muted small">{hint}</span>}</div>{children}</section>;
}
