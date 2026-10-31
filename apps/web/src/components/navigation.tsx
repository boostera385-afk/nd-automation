"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Files, Settings2, Menu, X, ArrowDownUp, MonitorCog, MonitorCheck } from "lucide-react";
import { primaryNavigation, navigationSection } from "@/lib/workflow-navigation";

const icons = [LayoutDashboard, ArrowDownUp, MonitorCog, MonitorCheck, Files];

const pageLabels: Record<string, string> = {
  today: "Today", yesterday: "Yesterday", checks: "Post checks", posts: "All posts", customers: "Customers", comments: "Comments",
  reports: "Reports", responses: "Responses", sessions: "Work sessions", settings: "Settings / More", "sheet-sync": "Advanced import & export", automation: "Worker setup", content: "Content & approvals", profiles: "Profiles", publishing: "Publishing diagnostics", "master-sheet": "Master Sheet", run: "Run automation", results: "Results",
};

export function Navigation({ isStaff = false }: { isStaff?: boolean }) {
  const path = usePathname();
  const section = navigationSection(path);
  return (
    <nav aria-label="Main navigation" className="navigation">
      <div className="nav-group"><p className="nav-group-label">Your work</p>{primaryNavigation.map((item, index) => {
        if (item.staff && !isStaff) return null;
        const Icon = icons[index];
        return <Link key={item.href} href={item.href} className={section === item.href ? "active" : ""} aria-current={section === item.href ? "page" : undefined}><Icon size={18} aria-hidden /><span>{item.label}</span></Link>;
      })}</div>
      <div className="nav-group"><Link href="/dashboard/settings" className={section === "/dashboard/settings" ? "active" : ""} aria-current={section === "/dashboard/settings" ? "page" : undefined}><Settings2 size={18} aria-hidden /><span>Settings / More</span></Link></div>
    </nav>
  );
}

export function Breadcrumbs() {
  const path = usePathname();
  const [, , section, child] = path.split("/");
  const trail: { label: string; href?: string }[] = [{ label: "Workspace", href: "/dashboard" }];
  if (!section) trail.push({ label: "Home" });
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
