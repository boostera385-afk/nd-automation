"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, CalendarDays, History, ClipboardCheck, Files, Users, MessageSquare, ChartNoAxesCombined, Clock3, Settings2, Menu, X, ArrowDownUp, type LucideIcon } from "lucide-react";

type NavItem = readonly [href: string, label: string, icon: LucideIcon];

function navGroups(isStaff: boolean): { label: string; items: NavItem[] }[] {
  return [
    { label: "Workspace", items: [["/dashboard", "Overview", LayoutDashboard], ["/dashboard/today", "Today", CalendarDays], ["/dashboard/yesterday", "Yesterday", History], ["/dashboard/checks", "Post checks", ClipboardCheck]] },
    { label: "Records", items: [["/dashboard/posts", "All posts", Files], ["/dashboard/customers", "Customers", Users], ["/dashboard/comments", "Comments", MessageSquare], ...(isStaff ? [["/dashboard/sheet-sync", "Import & export", ArrowDownUp] as const] : [])] },
    { label: "Insights", items: [["/dashboard/reports", "Reports", ChartNoAxesCombined], ["/dashboard/sessions", "Work sessions", Clock3]] },
    { label: "Account", items: [["/dashboard/settings", "Workspace settings", Settings2]] },
  ];
}

const pageLabels: Record<string, string> = {
  today: "Today", yesterday: "Yesterday", checks: "Post checks", posts: "All posts", customers: "Customers", comments: "Comments",
  reports: "Reports", sessions: "Work sessions", settings: "Workspace settings", "sheet-sync": "Import & export",
};

function isActive(path: string, href: string) {
  return href === "/dashboard" ? path === href : path === href || path.startsWith(`${href}/`);
}

export function Navigation({ isStaff = false }: { isStaff?: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Main navigation" className="navigation">
      {navGroups(isStaff).map((group) => (
        <div className="nav-group" key={group.label}>
          <p className="nav-group-label">{group.label}</p>
          {group.items.map(([href, label, Icon]) => {
            const active = isActive(path, href);
            return <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={18} aria-hidden /><span>{label}</span></Link>;
          })}
        </div>
      ))}
    </nav>
  );
}

export function Breadcrumbs() {
  const path = usePathname();
  const [, , section, child] = path.split("/");
  const trail: { label: string; href?: string }[] = [{ label: "Workspace", href: "/dashboard" }];
  if (!section) trail.push({ label: "Overview" });
  else {
    const label = pageLabels[section] ?? "Page";
    if (!child) trail.push({ label });
    else trail.push({ label, href: `/dashboard/${section}` }, { label: section === "posts" && child === "new" ? "Record a post" : "Details" });
  }
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>{trail.map((item, index) => <li key={item.label}>{item.href && index < trail.length - 1 ? <Link href={item.href}>{item.label}</Link> : <span aria-current={index === trail.length - 1 ? "page" : undefined}>{item.label}</span>}</li>)}</ol>
    </nav>
  );
}

// Open state is keyed to the current path, so navigating anywhere closes the drawer without an effect.
export function MenuButton() {
  const path = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === path;

  useEffect(() => {
    document.documentElement.dataset.nav = open ? "open" : "closed";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenPath(null); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); delete document.documentElement.dataset.nav; };
  }, [open]);

  return (
    <>
      <button type="button" className="menu-button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="sidebar" onClick={() => setOpenPath(open ? null : path)}>{open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}</button>
      {open && <button type="button" className="nav-backdrop" aria-label="Close navigation" tabIndex={-1} onClick={() => setOpenPath(null)} />}
    </>
  );
}
