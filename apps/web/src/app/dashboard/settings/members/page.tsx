import Link from "next/link";
import { z } from "zod";
import { requireWorkspace } from "@/lib/data";
import { PageHeader, Panel } from "@/components/ui";
import { MembersPanel, type MemberRole } from "@/components/members-panel";

const rosterSchema = z.array(z.strictObject({
  member: z.uuid(),
  email: z.email(),
  member_role: z.enum(["owner", "admin", "operator", "customer"]),
})).max(50);

export default async function WorkspaceMembers() {
  const { db, organization, membership, user, isStaff } = await requireWorkspace();
  if (!isStaff) return <>
    <PageHeader title="Workspace members" description="Membership is managed by owners and administrators." />
    <Panel title="View-only role"><p>Your role shows customer results only. Adding, removing or changing member roles is not available for this role; ask an owner or administrator of the business for changes.</p>
      <p><Link className="button secondary" href="/dashboard">Back to Home</Link></p>
    </Panel>
  </>;
  const roster = await db.rpc("reporting_list_workspace_members", { org: organization.id });
  // The functions live in a reviewed proposal; until it is applied to the
  // hosted database, say so exactly instead of showing an empty member list.
  if (roster.error) return <>
    <PageHeader title="Workspace members" description="Add a teammate by the email they signed up with." />
    <Panel title="Member management unavailable"><p role="alert">Member management is not enabled on this database yet. Ask the administrator to apply the <code>workspace_members</code> proposal (hosted migration name <code>workspace_members_v1</code>) in Supabase, then reload this page. No membership was changed.</p>
      <p><Link className="button secondary" href="/dashboard/settings">Back to Settings</Link></p>
    </Panel>
  </>;
  const parsed = rosterSchema.safeParse(roster.data);
  if (!parsed.success) throw new Error("The member list could not be verified completely. No membership was changed.");
  const members = parsed.data.map((row) => ({ ...row, member_role: row.member_role as MemberRole }));
  return <>
    <PageHeader title="Workspace members" description="Add a teammate by the exact email they signed up with. They see this business and its data immediately after refreshing; no invite email is sent." />
    <Panel title="How adding works"><p>The teammate first signs up on their own and confirms their email address. Then you add that exact address here — there is no invite email and no account creation on their behalf. Adding is permanent for the account: one account can only ever belong to one workspace. Members with open work (an open work session or queued jobs) cannot be removed or demoted until it is finished.</p></Panel>
    <Panel title="Members"><MembersPanel members={members} viewer={user.id} viewerIsOwner={membership.role === "owner"} /></Panel>
    <p><Link className="button secondary" href="/dashboard/settings">Back to Settings</Link> · <Link href="/dashboard/settings/computer">Teammate computer setup</Link></p>
  </>;
}
