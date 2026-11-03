"use client";

import { useActionState } from "react";
import { addWorkspaceMember, removeWorkspaceMember, setMemberWorkspaceRole } from "@/app/actions/members";
import { WorkspaceField } from "./workspace-context";

export type MemberRole = "owner" | "admin" | "operator" | "customer";
export type WorkspaceMember = { member: string; email: string; member_role: MemberRole };

const roleLabel: Record<MemberRole, string> = { owner: "Owner", admin: "Administrator", operator: "Operator", customer: "Customer viewer" };
const roles: MemberRole[] = ["owner", "admin", "operator", "customer"];

function MemberRow({ row, viewer, viewerIsOwner }: { row: WorkspaceMember; viewer: string; viewerIsOwner: boolean }) {
  const [roleState, saveRole, rolePending] = useActionState(setMemberWorkspaceRole, {});
  const [removeState, removeMember, removePending] = useActionState(removeWorkspaceMember, {});
  // The database enforces the real rules; these flags only hide controls that
  // could never succeed for this viewer, so nothing misleading is offered.
  const mayChangeRole = viewerIsOwner && row.member !== viewer;
  const mayRemove = row.member !== viewer && (viewerIsOwner || row.member_role === "operator" || row.member_role === "customer");
  if (row.member === viewer) return <li><strong>{row.email}</strong> — {roleLabel[row.member_role]} (you)</li>;
  return <li><details className="workflow-details"><summary>{row.email} — {roleLabel[row.member_role]}</summary>
    {mayChangeRole && <form action={saveRole} className="form-grid">
      <WorkspaceField />
      <input type="hidden" name="member" value={row.member} />
      <label>Role<select name="member_role" defaultValue={row.member_role}>{roles.map((value) => <option key={value} value={value}>{roleLabel[value]}</option>)}</select></label>
      <button className="button secondary" type="submit" disabled={rolePending} aria-busy={rolePending}>{rolePending ? "Saving…" : "Save role"}</button>
    </form>}
    {roleState.error && <p className="notice error" role="alert">{roleState.error}</p>}
    {roleState.success && <p className="notice success" role="status">{roleState.success}</p>}
    {mayRemove && <form action={removeMember} className="form-grid">
      <WorkspaceField />
      <input type="hidden" name="member" value={row.member} />
      <label className="check-label"><input type="checkbox" name="confirmed" required />Remove business access for {row.email}. Their past records stay in the business history; their customer access is removed with it.</label>
      <button className="button secondary" type="submit" disabled={removePending} aria-busy={removePending}>{removePending ? "Removing…" : "Remove member"}</button>
    </form>}
    {removeState.error && <p className="notice error" role="alert">{removeState.error}</p>}
    {removeState.success && <p className="notice success" role="status">{removeState.success}</p>}
  </details></li>;
}

export function MembersPanel({ members, viewer, viewerIsOwner }: { members: WorkspaceMember[]; viewer: string; viewerIsOwner: boolean }) {
  const [addState, addAction, addPending] = useActionState(addWorkspaceMember, {});
  const addable: MemberRole[] = viewerIsOwner ? roles : ["operator", "customer"];
  return <>
    <form action={addAction} className="form-grid">
      <WorkspaceField />
      <label>Teammate email<input name="email" type="email" required maxLength={254} autoComplete="off" placeholder="The address they signed up with" /></label>
      <label>Role<select name="member_role" defaultValue="operator">{addable.map((value) => <option key={value} value={value}>{roleLabel[value]}</option>)}</select></label>
      <label className="check-label"><input type="checkbox" name="authorized" required />This person works for this business and may see its customer data. No invite email is sent; they must already have a confirmed account.</label>
      {addState.error && <p className="notice error" role="alert">{addState.error}</p>}
      {addState.success && <p className="notice success" role="status">{addState.success}</p>}
      <button className="button" type="submit" disabled={addPending} aria-busy={addPending}>{addPending ? "Adding…" : "Add member"}</button>
    </form>
    <ul className="member-list">{members.map((row) => <MemberRow key={row.member} row={row} viewer={viewer} viewerIsOwner={viewerIsOwner} />)}</ul>
  </>;
}
