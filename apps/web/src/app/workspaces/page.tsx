import Link from "next/link";
import { z } from "zod";
import { getWorkspaceAccess } from "@/lib/data";
import { MAX_WORKSPACES } from "@/lib/workspace-selection";
import { AuthScreen } from "@/components/auth-screen";
import { ActionForm } from "@/components/action-form";
import { selectWorkspace } from "@/app/actions/workspaces";
import { signOut } from "@/app/actions/auth";

export default async function Workspaces({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { db, user, memberships } = await getWorkspaceAccess();
  if (!memberships.length) return <AuthScreen title="No business access" description="Ask your team owner for access, or explicitly create your own private account."><Link className="button" href="/dashboard">Account setup</Link><form action={signOut}><button className="button secondary">Sign out</button></form></AuthScreen>;
  const result = await db.from("reporting_organizations").select("id,name").in("id", memberships.map((row) => row.organization_id)).order("name").order("id").limit(MAX_WORKSPACES + 1);
  const parsed = z.array(z.strictObject({ id: z.uuid(), name: z.string().min(1).max(100) })).max(MAX_WORKSPACES).safeParse(result.data);
  if (result.error || !parsed.success || parsed.data.length !== memberships.length
    || new Set(parsed.data.map((row) => row.id)).size !== memberships.length
    || parsed.data.some((row) => !memberships.some((membership) => membership.organization_id === row.id))) {
    throw new Error("The authorized business list could not be verified completely. No business was selected.");
  }
  return <AuthScreen title="Choose your business" description="Open one authorized workspace. This changes dashboard context only; it does not start, pause, or stop any worker.">
    {notice === "context-changed" && <p className="notice error" role="alert">Account or workspace changed since that form was opened. No operation was requested by that form. Choose the intended business and review fresh data before trying again.</p>}
    <p className="notice">Finish or pause authorized work in the current business before switching. Other tabs must be reloaded; their old forms cannot submit into the new business.</p>
    <ActionForm action={selectWorkspace} label="Open selected business">
      <input type="hidden" name="actor" value={user.id} />
      <label>Business<select name="workspace" required defaultValue=""><option value="" disabled>Choose an authorized business</option>{parsed.data.map((row) => <option key={row.id} value={row.id}>{row.name} · {memberships.find((membership) => membership.organization_id === row.id)!.role} · {row.id}</option>)}</select></label>
      <label className="check"><input name="confirmed" type="checkbox" required />I checked the intended business. Existing worker sessions are unchanged.</label>
    </ActionForm>
    <form action={signOut}><button className="button secondary">Sign out</button></form>
  </AuthScreen>;
}
