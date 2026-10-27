-- Staff-only Incogniton profile inventory for exact-UUID assignment selection.
-- Inventory presence is informational: it never authorizes launches and is not proof a profile exists.
create table public.reporting_profile_inventory (
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  profile_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 200),
  group_name text not null default 'Unassigned' check (char_length(trim(group_name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','archived')),
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, profile_id)
);
create index reporting_profile_inventory_importer on public.reporting_profile_inventory(imported_by);
alter table public.reporting_profile_inventory enable row level security;
create policy inventory_staff_read on public.reporting_profile_inventory for select to authenticated using (private_reporting.is_staff(organization_id));
revoke all on public.reporting_profile_inventory from public, anon, authenticated;
grant select on public.reporting_profile_inventory to authenticated;

create function private_reporting.valid_profile_row(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare pid uuid;
begin
  if value is null or jsonb_typeof(value)<>'object' then return false; end if;
  if not (value ?& array['profile_id','name','group_name'])
    or exists(select 1 from jsonb_object_keys(value) k where k not in ('profile_id','name','group_name')) then return false; end if;
  if jsonb_typeof(value->'profile_id')<>'string' then return false; end if;
  begin
    pid := (value->>'profile_id')::uuid;
  exception when others then return false;
  end;
  return pid is not null
    and jsonb_typeof(value->'name')='string' and char_length(trim(value->>'name')) between 1 and 200
    and jsonb_typeof(value->'group_name')='string' and char_length(trim(value->>'group_name')) between 1 and 200;
end $$;
revoke all on function private_reporting.valid_profile_row(jsonb) from public, anon, authenticated;

create function public.reporting_import_profiles(org uuid, rows jsonb, archive_missing boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inserted_count integer; updated_count integer; archived_count integer := 0;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if archive_missing is null then raise exception 'Choose whether missing profiles are archived'; end if;
  if rows is null or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows) not between 1 and 5000 then raise exception 'Import between 1 and 5000 profiles'; end if;
  if exists(select 1 from jsonb_array_elements(rows) r where not private_reporting.valid_profile_row(r.value)) then raise exception 'Invalid profile row'; end if;
  if (select count(*) from (select distinct (r.value->>'profile_id')::uuid from jsonb_array_elements(rows) r) d)
     <> jsonb_array_length(rows) then raise exception 'Duplicate profile ID in import'; end if;
  -- Serialize concurrent inventory imports for the same workspace.
  perform pg_advisory_xact_lock(hashtextextended(org::text, 913));
  with src as (
    select (r.value->>'profile_id')::uuid as pid, trim(r.value->>'name') as nm, trim(r.value->>'group_name') as grp
    from jsonb_array_elements(rows) r
  ), up as (
    insert into public.reporting_profile_inventory(organization_id, profile_id, name, group_name, status, imported_by, updated_at)
      select org, pid, nm, grp, 'active', auth.uid(), clock_timestamp() from src
    on conflict (organization_id, profile_id) do update
      set name=excluded.name, group_name=excluded.group_name, status='active', imported_by=excluded.imported_by, updated_at=clock_timestamp()
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new), count(*) filter (where not is_new) into inserted_count, updated_count from up;
  if archive_missing then
    update public.reporting_profile_inventory i set status='archived', updated_at=clock_timestamp()
      where i.organization_id=org and i.status='active' and not exists(
        select 1 from jsonb_array_elements(rows) r where (r.value->>'profile_id')::uuid = i.profile_id);
    get diagnostics archived_count = row_count;
  end if;
  return jsonb_build_object('received', jsonb_array_length(rows), 'inserted', inserted_count, 'updated', updated_count, 'archived', archived_count);
end $$;

create function public.reporting_set_profile_archived(org uuid, profile uuid, archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if profile is null or archived is null then raise exception 'Invalid request'; end if;
  update public.reporting_profile_inventory set status=case when archived then 'archived' else 'active' end, updated_at=clock_timestamp()
    where organization_id=org and profile_id=profile;
  if not found then raise exception 'Profile not found in inventory'; end if;
end $$;

revoke all on function public.reporting_import_profiles(uuid,jsonb,boolean), public.reporting_set_profile_archived(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.reporting_import_profiles(uuid,jsonb,boolean), public.reporting_set_profile_archived(uuid,uuid,boolean) to authenticated;
comment on table public.reporting_profile_inventory is 'Staff-maintained claim of known Incogniton profile UUID/name/group mappings. Presence is not live existence or readiness; assignments still require explicit customer authorization.';
notify pgrst, 'reload schema';
