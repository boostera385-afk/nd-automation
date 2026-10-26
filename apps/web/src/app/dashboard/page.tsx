import Link from "next/link";
import { ArrowUpRight, Check, Files, Eye, MessageSquare, ClipboardList } from "lucide-react";
import { getContext, getDashboardData } from "@/lib/data";
import { businessDate, isInDay, isStale, shiftDay } from "@/lib/time";
import { createWorkspace } from "@/app/actions/reporting";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel, StatCard } from "@/components/ui";
import { PublicationTable } from "@/components/publication-table";

const roadmap = [
  ["Create your workspace", "A private, empty space. No legacy records are imported."],
  ["Add your customers", "Set each customer’s timezone explicitly."],
  ["Record authorized post links", "Add them one by one or review a CSV preview."],
  ["Save sourced observations", "Review each exact post and record what you saw."],
] as const;

export default async function Overview() {
  const { organization, isStaff } = await getContext();
  if (!organization) return <><PageHeader eyebrow="WELCOME" title="Set up your private workspace" description="Your verified account has no access to anyone else’s customer records. Start with an empty workspace and add only what you are authorized to report on." /><div className="onboarding-grid"><Panel title="Workspace details"><ActionForm action={createWorkspace} label="Create empty workspace"><label>Workspace name<input name="name" minLength={2} maxLength={100} required autoComplete="organization" placeholder="Your business name" /><span className="field-hint">Shown to you and your team. You can use your business name.</span></label><p className="field-hint">Default business timezone: America/Los_Angeles (PST/PDT handled automatically). No legacy records are imported automatically.</p></ActionForm></Panel><section className="panel" aria-labelledby="roadmap-heading"><div className="panel-heading"><h2 id="roadmap-heading">What happens next</h2><span className="muted small">4 short steps</span></div><ol className="stepper">{roadmap.map(([title, text], index) => <li key={title} className={index === 0 ? "current" : ""}><span className="step-number" aria-hidden>{index + 1}</span><div><strong>{title}</strong><small>{text}</small></div></li>)}</ol></section></div></>;
  const { publications, customers, comments, truncated } = await getDashboardData();
  const today = businessDate(new Date(), organization.time_zone);
  const yesterday = shiftDay(today, -1);
  const todayPosts = publications.filter((post) => isInDay(post.published_at, today, organization.time_zone));
  const yesterdayPosts = publications.filter((post) => isInDay(post.published_at, yesterday, organization.time_zone));
  const attention = publications.filter((post) => isStale(post.last_observed_at) || ["unknown", "unavailable", "confirmed_removed"].includes(post.visibility));
  const cards = [
    { label: "Recorded as published today", value: todayPosts.length, hint: `${today} · business date`, icon: Files },
    { label: "Yesterday · last observed live", value: yesterdayPosts.filter((p) => p.visibility === "live").length, hint: `${yesterdayPosts.length} publication records yesterday`, icon: Eye },
    { label: "Comments first observed today", value: comments.filter((c) => isInDay(c.first_observed_at, today, organization.time_zone)).length, hint: "Not inferred platform creation counts", icon: MessageSquare },
    { label: "Needs manual review", value: attention.length, hint: "Unknown, stale or unavailable observations", icon: ClipboardList },
  ];
  const checklist = [
    { label: "Add a customer and confirm their timezone", done: customers.length > 0, href: "/dashboard/customers" },
    { label: "Record an authorized post link or review a CSV import", done: publications.length > 0, href: "/dashboard/posts/new" },
    { label: "Open an exact post and save a sourced observation", done: publications.some((post) => post.last_observed_at), href: publications[0] ? `/dashboard/posts/${publications[0].id}` : "/dashboard/posts/new" },
    { label: "Record comments and download a daily snapshot", done: comments.length > 0, href: "/dashboard/reports" },
  ];
  const completed = checklist.filter((item) => item.done).length;
  return <><PageHeader title="Your working day, at a glance." description={`Track customer post records and review yesterday’s observations. Business date: ${today}.`} actions={isStaff && <><Link className="button secondary" href="/dashboard/checks">Record checks</Link><Link className="button" href="/dashboard/posts/new">Record post link <ArrowUpRight size={16} /></Link></>} />{truncated && <p className="notice">Loaded-data limit reached. Counts are partial; full pagination is not yet implemented.</p>}<div className="stats-grid">{cards.map((card) => <StatCard key={card.label} {...card} />)}</div><div className="notice subtle"><strong>What these numbers mean</strong><p>Records come from authorized manual entry or reviewed CSV imports. “Observed live” means someone reviewed that exact post at the saved time—not that this app checked it automatically.</p></div><Panel title="Latest post records" hint={`${customers.length} customers · ${organization.time_zone}`}><PublicationTable publications={publications.slice(0, 8)} customers={customers} zone={organization.time_zone} /></Panel><div className={isStaff ? "two-column" : undefined}>{isStaff && <Panel title="Setup checklist" hint={`${completed} of ${checklist.length} done`}><div className="progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={completed}><span style={{ width: `${(completed / checklist.length) * 100}%` }} /></div><ul className="checklist">{checklist.map((item) => <li key={item.label} className={item.done ? "done" : ""}><span className="check-mark" aria-hidden>{item.done && <Check size={13} />}</span>{item.done ? <span>{item.label}<span className="sr-only"> (done)</span></span> : <Link href={item.href}>{item.label}</Link>}</li>)}</ul></Panel>}<Panel title="Keep the session honest"><p className="muted">Start/Pause/End tracks your reporting work. It does not open browsers, post content or create accounts. When the computer is off, stored observations remain visible with their actual timestamps.</p><Link className="text-link" href="/dashboard/settings">See delivered and pending features <ArrowUpRight size={15} /></Link></Panel></div></>;
}
