-- LOCAL CANDIDATE ONLY. Generate/review an imperative migration with the CLI
-- before application. Owner-confirmed membership management only: no invite
-- emails are sent, no accounts are created here, and the single-workspace
-- per-person rule stays enforced. Teammates sign up and verify their own
-- email address first; adding that exact email then grants immediate access.

-- Attributable in-progress work for one member: an open work session, browser
-- tasks they queued (created_by), or check/publish jobs tied to their session.
-- Organization-level helpers are shared and carry no user, so they never block;
-- dispatch itself already refuses a session owner who lost a staff role.
create function private_reporting.member_has_open_work(org uuid, member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.reporting_work_sessions s
      where s.organization_id = org and s.user_id = member and s.status <> 'closed')
    or exists(select 1 from public.reporting_automation_tasks t
      where t.organization_id = org and t.created_by = member and t.status in ('pending', 'leased'))
    or exists(select 1 from public.reporting_check_jobs j
      join public.reporting_work_sessions s on s.id = j.session_id and s.organization_id = j.organization_id
      where j.organization_id = org and s.user_id = member and j.status in ('pending', 'leased'))
    or exists(select 1 from public.reporting_publish_jobs p
      join public.reporting_work_sessions s on s.id = p.session_id and s.organization_id = p.organization_id
      where p.organization_id = org and s.user_id = member and p.status in ('pending', 'leased'))
$$;
revoke all on function private_reporting.member_has_open_work(uuid, uuid) from public, anon, authenticated;

create function public.reporting_list_workspace_members(org uuid)
returns table(member uuid, email text, member_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  return query select m.user_id, u.email, m.role
    from public.reporting_memberships m join auth.users u on u.id = m.user_id
    where m.organization_id = org
    order by m.role, u.email;
end $$;

create function public.reporting_add_workspace_member(org uuid, address text, member_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller_role text; target uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  select m.role into caller_role from public.reporting_memberships m
    where m.organization_id = org and m.user_id = (select auth.uid());
  if caller_role not in ('owner', 'admin') then raise exception 'Only an owner or administrator can add members'; end if;
  if member_role not in ('owner', 'admin', 'operator', 'customer') then raise exception 'Choose a valid workspace role'; end if;
  if member_role in ('owner', 'admin') and caller_role <> 'owner'
    then raise exception 'Only an owner can grant owner or administrator roles'; end if;
  if address is null or char_length(address) > 254 or address !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    then raise exception 'Enter a valid email address'; end if;
  perform pg_advisory_xact_lock(hashtextextended('members:' || org::text, 0));
  if (select count(*) from public.reporting_memberships m where m.organization_id = org) >= 50
    then raise exception 'This workspace already has 50 members'; end if;
  select u.id into target from auth.users u
    where lower(u.email) = lower(address) and u.email_confirmed_at is not null;
  if target is null then raise exception 'No verified account exists for that email. The member must sign up and verify their email first.'; end if;
  if exists(select 1 from public.reporting_memberships m where m.user_id = target)
    then raise exception 'That account already belongs to a workspace'; end if;
  insert into public.reporting_memberships(organization_id, user_id, role) values (org, target, member_role);
  return target;
end $$;

create function public.reporting_set_member_role(org uuid, member uuid, member_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare caller_role text; existing_role text;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  select m.role into caller_role from public.reporting_memberships m
    where m.organization_id = org and m.user_id = (select auth.uid());
  if caller_role <> 'owner' then raise exception 'Only an owner can change member roles'; end if;
  if member = auth.uid() then raise exception 'Owners cannot change their own role here'; end if;
  if member_role not in ('owner', 'admin', 'operator', 'customer') then raise exception 'Choose a valid workspace role'; end if;
  perform pg_advisory_xact_lock(hashtextextended('members:' || org::text, 0));
  select m.role into existing_role from public.reporting_memberships m
    where m.organization_id = org and m.user_id = member for update;
  if existing_role is null then raise exception 'Member not found'; end if;
  if existing_role = member_role then return; end if;
  -- Defense in depth: the self-change block above means this branch is not
  -- reachable today, but it keeps any future caller change from ever
  -- orphaning the workspace.
  if existing_role = 'owner' and member_role <> 'owner'
    and (select count(*) from public.reporting_memberships m where m.organization_id = org and m.role = 'owner') = 1
    then raise exception 'The last owner cannot be demoted'; end if;
  if private_reporting.member_has_open_work(org, member) then raise exception 'The member has work in progress (open session or queued jobs). End the session and finish the queue first.'; end if;
  update public.reporting_memberships set role = member_role where organization_id = org and user_id = member;
end $$;

create function public.reporting_remove_workspace_member(org uuid, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare caller_role text; existing_role text;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  select m.role into caller_role from public.reporting_memberships m
    where m.organization_id = org and m.user_id = (select auth.uid());
  if caller_role not in ('owner', 'admin') then raise exception 'Only an owner or administrator can remove members'; end if;
  if member = auth.uid() then raise exception 'Ask another owner to remove your access; self-removal is not allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('members:' || org::text, 0));
  select m.role into existing_role from public.reporting_memberships m
    where m.organization_id = org and m.user_id = member for update;
  if existing_role is null then raise exception 'Member not found'; end if;
  if caller_role = 'admin' and existing_role in ('owner', 'admin')
    then raise exception 'Administrators can only remove operators and customer viewers'; end if;
  -- Defense in depth as above: an owner caller implies a second owner exists
  -- whenever the target is an owner, so today this only guards future drift.
  if existing_role = 'owner'
    and (select count(*) from public.reporting_memberships m where m.organization_id = org and m.role = 'owner') = 1
    then raise exception 'The last owner cannot be removed'; end if;
  if private_reporting.member_has_open_work(org, member) then raise exception 'The member has work in progress (open session or queued jobs). End the session and finish the queue first.'; end if;
  -- customer_access rows cascade with the membership; reporting history is kept.
  delete from public.reporting_memberships where organization_id = org and user_id = member;
end $$;

revoke all on function public.reporting_list_workspace_members(uuid),
  public.reporting_add_workspace_member(uuid, text, text),
  public.reporting_set_member_role(uuid, uuid, text),
  public.reporting_remove_workspace_member(uuid, uuid),
  private_reporting.member_has_open_work(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reporting_list_workspace_members(uuid),
  public.reporting_add_workspace_member(uuid, text, text),
  public.reporting_set_member_role(uuid, uuid, text),
  public.reporting_remove_workspace_member(uuid, uuid) to authenticated;notify pgrst, 'reload schema';
