import Link from "next/link";
import { LogOut } from "lucide-react";
import { getContext, getDashboardData } from "@/lib/data";
import { signOut } from "@/app/actions/auth";
import { Breadcrumbs, MenuButton, Navigation } from "@/components/navigation";
import { SessionBar } from "@/components/session-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationCenter } from "@/components/notification-center";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, organization, membership, isStaff } = await getContext();
  const { session } = await getDashboardData();
  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a><aside id="sidebar" className="sidebar"><Link className="brand" href="/dashboard"><span className="brand-mark">ND</span><span>ND Automations<small>{isStaff ? "AUTOMATION WORKSPACE" : "CUSTOMER RESULTS"}</small></span></Link><Navigation isStaff={isStaff} /><div className="sidebar-bottom"><div className="user-block"><span className="avatar" aria-hidden>{user.email?.slice(0, 1).toUpperCase() || "U"}</span><div><strong title={user.email || undefined}>{organization?.name || "New workspace"}</strong><small>{membership?.role || "Unassigned account"}</small></div><form action={signOut}><button className="icon-button" aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></form></div></div></aside><div className="main-shell"><header className="topbar"><div className="topbar-left"><MenuButton /><Breadcrumbs /></div><div className="topbar-right">{organization && <NotificationCenter />}<ThemeToggle /></div></header><main id="main" tabIndex={-1} className="workspace"><SessionBar session={session} zone={organization?.time_zone || "America/Los_Angeles"} initialTime={new Date().toISOString()} canEdit={isStaff} />{children}</main><footer className="app-footer"><span>ND Automations · Sheet-first workflow.</span><span>Saved observations, not a continuous live-status guarantee.</span></footer></div></div>;
}
