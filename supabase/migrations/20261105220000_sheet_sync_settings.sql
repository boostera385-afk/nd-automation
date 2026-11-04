-- Workspace-saved Master Sheet connection: turns setup into 2 steps.
--
-- Before this migration, connecting the read-only Sheet connector required an
-- administrator to copy three environment values into the hosting project and
-- redeploy — the step almost everyone got stuck on. The connection is now
-- saved once in the workspace, exactly like a worker credential: after the
-- one-time Google step (create the small read-only connector, copy its /exec
-- URL), step 2 is "paste URL + token → Save" in the dashboard.
--
-- Server environment values keep working and take precedence when present, so
-- existing deployments and local development change nothing.
--
-- The sync_token protects a READ-ONLY metadata bridge (profile name, link,
-- status, short title). The server must present it to Google on each read, so
-- it is stored rather than hashed. It is never selectable through the public
-- API schema; staff reach it only through the narrow functions below. What the
-- token can expose is the same safe projection staff already see in the
-- dashboard — no credentials, cookies, proxies or other Sheet columns.

create table private_reporting.sheet_sync_settings(
  organization_id uuid primary key references public.reporting_organizations(id) on delete cascade,
  sheet_id text not null check (sheet_id ~ '^[A-Za-z0-9_-]{20,200}$'),
  endpoint_url text not null check (endpoint_url ~ '^https://script[.]google[.]com/(a/macros/[A-Za-z0-9.-]+/)?macros/s/[A-Za-z0-9_-]+/exec$'),
  sync_token text not null check (char_length(sync_token) between 24 and 256 and sync_token ~ '^[A-Za-z0-9_-]+$'),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp()
);
comment on table private_reporting.sheet_sync_settings is 'One saved read-only Sheet connector per workspace. Never exposed through the API schema; staff use the narrow functions only.';
revoke all on private_reporting.sheet_sync_settings from public, anon, authenticated;

create function public.reporting_save_sheet_sync(org uuid, sheet_id text, endpoint_url text, sync_token text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  insert into private_reporting.sheet_sync_settings(organization_id, sheet_id, endpoint_url, sync_token, updated_by)
    values(org, btrim(sheet_id), btrim(endpoint_url), btrim(sync_token), auth.uid())
  on conflict (organization_id) do update
    set sheet_id=excluded.sheet_id, endpoint_url=excluded.endpoint_url, sync_token=excluded.sync_token,
        updated_by=excluded.updated_by, updated_at=clock_timestamp();
end $$;

create function public.reporting_get_sheet_sync(org uuid) returns table(endpoint_url text, sync_token text)
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  return query select s.endpoint_url::text, s.sync_token::text
    from private_reporting.sheet_sync_settings s where s.organization_id=org;
end $$;

create function public.reporting_clear_sheet_sync(org uuid) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  delete from private_reporting.sheet_sync_settings where organization_id=org;
end $$;

revoke all on function public.reporting_save_sheet_sync(uuid,text,text,text), public.reporting_get_sheet_sync(uuid), public.reporting_clear_sheet_sync(uuid) from public, anon, authenticated;
grant execute on function public.reporting_save_sheet_sync(uuid,text,text,text), public.reporting_get_sheet_sync(uuid), public.reporting_clear_sheet_sync(uuid) to authenticated;
