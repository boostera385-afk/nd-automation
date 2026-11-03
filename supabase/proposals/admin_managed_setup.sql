-- Candidate only: requires explicit hosted deployment approval.
-- Owners/admins configure; operators keep daily execution/reporting rights.
-- Preserve existing implementations (lease, revocation, import and ownership
-- guards) behind client-denied wrappers. No rows or memberships are changed.
create function private_reporting.is_setup_admin(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.reporting_memberships m
    join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null
    where m.organization_id=org and m.user_id=(select auth.uid())
      and m.role in ('owner','admin'))
$$;
revoke all on function private_reporting.is_setup_admin(uuid) from public,anon,authenticated;
grant execute on function private_reporting.is_setup_admin(uuid) to authenticated;

alter function public.reporting_register_worker(uuid,text,text) set schema private_reporting;
alter function public.reporting_bind_worker_profile(uuid,uuid,uuid,uuid,text) set schema private_reporting;
alter function public.reporting_revoke_worker(uuid,uuid) set schema private_reporting;
alter function public.reporting_reassign_worker_profile(uuid,uuid,uuid) set schema private_reporting;
alter function public.reporting_import_profiles(uuid,jsonb,boolean) set schema private_reporting;
alter function public.reporting_set_profile_archived(uuid,uuid,boolean) set schema private_reporting;
revoke all on function private_reporting.reporting_register_worker(uuid,text,text),
  private_reporting.reporting_bind_worker_profile(uuid,uuid,uuid,uuid,text),
  private_reporting.reporting_revoke_worker(uuid,uuid),
  private_reporting.reporting_reassign_worker_profile(uuid,uuid,uuid),
  private_reporting.reporting_import_profiles(uuid,jsonb,boolean),
  private_reporting.reporting_set_profile_archived(uuid,uuid,boolean)
  from public,anon,authenticated;

create function public.reporting_register_worker(org uuid, worker_name text, credential_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if not private_reporting.is_setup_admin(org) then raise exception 'Only a workspace owner or admin can change setup' using errcode='42501'; end if;
  return private_reporting.reporting_register_worker(org,worker_name,credential_hash);
end $$;
create function public.reporting_bind_worker_profile(org uuid, worker uuid, customer uuid, profile uuid, label text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if not private_reporting.is_setup_admin(org) then raise exception 'Only a workspace owner or admin can change setup' using errcode='42501'; end if;
  return private_reporting.reporting_bind_worker_profile(org,worker,customer,profile,label);
end $$;
create function public.reporting_revoke_worker(org uuid, worker uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private_reporting.is_setup_admin(org) then raise exception 'Only a workspace owner or admin can change setup' using errcode='42501'; end if;
  perform private_reporting.reporting_revoke_worker(org,worker);
end $$;
create function public.reporting_reassign_worker_profile(org uuid, binding uuid, replacement uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private_reporting.is_setup_admin(org) then raise exception 'Only a workspace owner or admin can change setup' using errcode='42501'; end if;
  perform private_reporting.reporting_reassign_worker_profile(org,binding,replacement);
end $$;
create function public.reporting_import_profiles(org uuid, rows jsonb, archive_missing boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private_reporting.is_setup_admin(org) then raise exception 'Only a workspace owner or admin can change setup' using errcode='42501'; end if;
  return private_reporting.reporting_import_profiles(org,rows,archive_missing);
end $$;
create function public.reporting_set_profile_archived(org uuid, profile uuid, archived boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private_reporting.is_setup_admin(org) then raise exception 'Only a workspace owner or admin can change setup' using errcode='42501'; end if;
  perform private_reporting.reporting_set_profile_archived(org,profile,archived);
end $$;
revoke all on function public.reporting_register_worker(uuid,text,text),
  public.reporting_bind_worker_profile(uuid,uuid,uuid,uuid,text),
  public.reporting_revoke_worker(uuid,uuid),
  public.reporting_reassign_worker_profile(uuid,uuid,uuid),
  public.reporting_import_profiles(uuid,jsonb,boolean),
  public.reporting_set_profile_archived(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.reporting_register_worker(uuid,text,text),
  public.reporting_bind_worker_profile(uuid,uuid,uuid,uuid,text),
  public.reporting_revoke_worker(uuid,uuid),
  public.reporting_reassign_worker_profile(uuid,uuid,uuid),
  public.reporting_import_profiles(uuid,jsonb,boolean),
  public.reporting_set_profile_archived(uuid,uuid,boolean) to authenticated;

alter policy customer_create on public.reporting_customers
  with check (private_reporting.is_setup_admin(organization_id));
alter policy customer_update on public.reporting_customers
  using (private_reporting.is_setup_admin(organization_id))
  with check (private_reporting.is_setup_admin(organization_id));
-- SELECT policies are unchanged: employees retain their workspace data access.
notify pgrst,'reload schema';
