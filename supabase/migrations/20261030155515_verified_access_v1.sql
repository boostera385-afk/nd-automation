-- Additive verified-access hardening. Apply once only after deployment approval.
-- Existing applied migration files and source/hosted history stay unchanged.
create function private_reporting.verified_human() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users u
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null)
$$;
revoke all on function private_reporting.verified_human() from public,anon,authenticated;
grant execute on function private_reporting.verified_human() to authenticated;

create or replace function private_reporting.is_staff(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private_reporting.verified_human() and exists(
    select 1 from public.reporting_memberships m where m.organization_id=org
      and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator'))
$$;
create or replace function private_reporting.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private_reporting.verified_human() and exists(
    select 1 from public.reporting_memberships m where m.organization_id=org and m.user_id=(select auth.uid()))
$$;
create or replace function private_reporting.can_view_customer(org uuid,customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private_reporting.verified_human() and (private_reporting.is_staff(org) or exists(
    select 1 from public.reporting_customer_access a join public.reporting_memberships m using(organization_id,user_id)
      where a.organization_id=org and a.customer_id=customer and a.user_id=(select auth.uid()) and m.role='customer'))
$$;
revoke all on function private_reporting.is_staff(uuid),private_reporting.is_member(uuid),
  private_reporting.can_view_customer(uuid,uuid) from public,anon,authenticated;
grant execute on function private_reporting.is_staff(uuid),private_reporting.is_member(uuid),
  private_reporting.can_view_customer(uuid,uuid) to authenticated;

alter policy membership_read_own on public.reporting_memberships
  using(user_id=(select auth.uid()) and (select private_reporting.verified_human()));
alter policy access_read_own on public.reporting_customer_access
  using(user_id=(select auth.uid()) and private_reporting.is_member(organization_id));
alter policy notification_state_read on public.reporting_notification_state
  using(user_id=(select auth.uid()) and private_reporting.is_member(organization_id));

-- Worker requests do not carry human Auth. Enforce the session owner's CURRENT
-- confirmation/membership when ANY existing planner creates or leases a check.
-- A trigger preserves the existing claim body, cross-type locks and replay rules;
-- it also covers the separately undeployed publishing protocol's check planner.
-- Legacy invalid sessions fail closed and need an operator to disable/reconcile
-- their profile authorization; they are not silently repaired or discarded.
create function private_reporting.require_verified_check_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('pending','leased') and not exists(
    select 1 from public.reporting_work_sessions s
      join auth.users u on u.id=s.user_id and u.email_confirmed_at is not null
      join public.reporting_memberships m on m.user_id=s.user_id and m.organization_id=s.organization_id
    where s.id=new.session_id and s.organization_id=new.organization_id and s.status='active'
      and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')) then
    raise exception 'Verified active session owner required for monitoring dispatch' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private_reporting.require_verified_check_session() from public,anon,authenticated;
create trigger reporting_verified_check_session before insert or update of status
  on public.reporting_check_jobs for each row execute function private_reporting.require_verified_check_session();

-- No credential, session, profile, publication or job row is changed by this migration.
notify pgrst, 'reload schema';
