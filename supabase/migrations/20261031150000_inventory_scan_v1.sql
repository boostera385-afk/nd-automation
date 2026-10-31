-- Inventory auto-detect, v1. One new read-only task kind: inventory_scan.
-- The automation agent on this device reads Incogniton's profile list and
-- returns UUID, name and group only (capped at 500 entries, honestly flagged
-- as truncated). Nothing here adds posting, listings or account creation.
alter table public.reporting_automation_tasks
  drop constraint reporting_automation_tasks_kind_check,
  add constraint reporting_automation_tasks_kind_check
  check (kind in ('profile_create', 'preset_snapshot', 'inventory_scan', 'cookie_import', 'proxy_import',
                  'cookie_write', 'proxy_write'));

create or replace function public.reporting_enqueue_automation_task(
  org uuid, worker uuid, kind text, summary text, payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare task uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if kind is null or kind not in ('profile_create', 'preset_snapshot', 'inventory_scan', 'cookie_import', 'proxy_import',
                                  'cookie_write', 'proxy_write')
    then raise exception 'This task type is not executable from the dashboard'; end if;
  if summary is null or char_length(trim(summary)) not between 1 and 200 then raise exception 'A short summary is required'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' or pg_column_size(payload) > 8000
    then raise exception 'Invalid task payload'; end if;
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('name', 'group', 'os', 'path', 'note', 'profile_id', 'replace'))
    then raise exception 'Unexpected task payload field'; end if;
  if kind = 'profile_create' then
    if jsonb_typeof(payload->'name') is distinct from 'string'
      or char_length(trim(payload->>'name')) not between 2 and 60
      then raise exception 'A profile name of 2-60 characters is required'; end if;
    if payload ? 'os' and (jsonb_typeof(payload->'os') is distinct from 'string'
      or payload->>'os' not in ('windows', 'mac', 'linux'))
      then raise exception 'Choose a supported operating system'; end if;
    if payload ? 'group' and (jsonb_typeof(payload->'group') is distinct from 'string'
      or char_length(payload->>'group') > 60)
      then raise exception 'The group name is too long'; end if;
  elsif kind in ('cookie_import', 'proxy_import') then
    if jsonb_typeof(payload->'path') is distinct from 'string'
      or char_length(payload->>'path') not between 3 and 400
      or char_length(trim(payload->>'path')) = 0
      then raise exception 'Enter the absolute path of the file on the worker machine'; end if;
  elsif kind in ('cookie_write', 'proxy_write') then
    if jsonb_typeof(payload->'profile_id') is distinct from 'string'
      or payload->>'profile_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise exception 'Choose the Incogniton profile to import into before queuing'; end if;
    if jsonb_typeof(payload->'path') is distinct from 'string'
      or char_length(payload->>'path') not between 3 and 400
      or char_length(trim(payload->>'path')) = 0
      then raise exception 'Enter the absolute path of the file on the worker machine'; end if;
    if payload ? 'replace' and jsonb_typeof(payload->'replace') is distinct from 'boolean'
      then raise exception 'Replace must be true or false'; end if;
  end if;
  -- inventory_scan carries only an optional note; every other key is already rejected above.
  if not exists(select 1 from public.reporting_workers where id = worker and organization_id = org and enabled)
    then raise exception 'Worker unavailable'; end if;
  if exists(select 1 from public.reporting_automation_tasks where worker_id = worker and status in ('pending', 'leased'))
    then raise exception 'This laptop already has a queued or running browser task. Wait for it to finish.'; end if;
  insert into public.reporting_automation_tasks(organization_id, worker_id, kind, summary, payload, created_by)
    values (org, worker, kind, trim(summary), payload, auth.uid()) returning id into task;
  return task;
end $$;

create or replace function public.reporting_complete_automation_task(
  credential text, task uuid, lease uuid, status text, task_result jsonb, task_error text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers; t public.reporting_automation_tasks;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id = w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  select * into t from public.reporting_automation_tasks where id = task and worker_id = w.id for update;
  if t.id is null or t.lease_token is distinct from lease then raise exception 'Invalid lease'; end if;
  if t.status in ('succeeded', 'failed', 'cancelled') then return false; end if;
  if t.status <> 'leased' or t.lease_expires_at <= clock_timestamp() then raise exception 'Expired or inactive lease'; end if;
  if status is null or status not in ('succeeded', 'failed') then raise exception 'Invalid completion status'; end if;
  if status = 'failed' then
    if task_result is not null then raise exception 'A failed task carries no result'; end if;
    if task_error is null or char_length(trim(task_error)) not between 1 and 2000 then raise exception 'A failure reason is required'; end if;
    update public.reporting_automation_tasks set status = 'failed', error = trim(task_error),
      completed_at = clock_timestamp() where id = t.id;
    return true;
  end if;
  if task_error is not null then raise exception 'A succeeded task carries no error'; end if;
  -- A scan result legitimately carries up to 500 inventory rows, so only this
  -- kind gets the larger allowance; every other result stays under 8000 bytes.
  if task_result is null or jsonb_typeof(task_result) <> 'object'
    or (t.kind <> 'inventory_scan' and pg_column_size(task_result) > 8000)
    or (t.kind = 'inventory_scan' and pg_column_size(task_result) > 64000)
    then raise exception 'Invalid task result'; end if;
  if t.kind = 'profile_create' then
    if jsonb_typeof(task_result->'profile_id') is distinct from 'string'
      or task_result->>'profile_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise exception 'A created profile id is required'; end if;
    if exists(select 1 from jsonb_object_keys(task_result) k where k not in ('profile_id', 'name', 'os'))
      then raise exception 'Unexpected result field'; end if;
  elsif t.kind = 'preset_snapshot' then
    if jsonb_typeof(task_result->'profiles') is distinct from 'number' or jsonb_typeof(task_result->'groups') is distinct from 'number'
      then raise exception 'A preset snapshot requires profile and group counts'; end if;
    if exists(select 1 from jsonb_object_keys(task_result) k where k not in ('profiles', 'groups', 'launched'))
      then raise exception 'Unexpected result field'; end if;
  elsif t.kind = 'inventory_scan' then
    if jsonb_typeof(task_result->'profiles') is distinct from 'array'
      or jsonb_array_length(task_result->'profiles') > 500
      or jsonb_typeof(task_result->'total') is distinct from 'number'
      or (task_result->>'total')::numeric < 0
      or jsonb_typeof(task_result->'truncated') is distinct from 'boolean'
      then raise exception 'A scan requires a capped profile list, a total and a truncation flag'; end if;
    if (task_result->>'total')::numeric > 500 and (task_result->>'truncated')::boolean is not true
      then raise exception 'A scan past the cap must say it was truncated'; end if;
    if exists(select 1 from jsonb_object_keys(task_result) k where k not in ('profiles', 'total', 'truncated'))
      then raise exception 'Unexpected result field'; end if;
    -- Same shape contract as the CSV inventory import: UUID, name, group only.
    if exists(select 1 from jsonb_array_elements(task_result->'profiles') p
              where not private_reporting.valid_profile_row(p.value))
      then raise exception 'Invalid scanned profile row'; end if;
  elsif t.kind in ('cookie_import', 'proxy_import') then
    if jsonb_typeof(task_result->'entries') is distinct from 'number' then raise exception 'An entry count is required'; end if;
    if exists(select 1 from jsonb_object_keys(task_result) k where k not in ('entries', 'with_credentials', 'domains', 'sample', 'note'))
      then raise exception 'Unexpected result field'; end if;
  elsif t.kind = 'cookie_write' then
    if jsonb_typeof(task_result->'written') is distinct from 'number'
      or (task_result->>'written')::numeric < 1 then raise exception 'The number of cookies imported is required'; end if;
    if exists(select 1 from jsonb_object_keys(task_result) k where k not in ('entries', 'written', 'replaced'))
      then raise exception 'Unexpected result field'; end if;
  elsif t.kind = 'proxy_write' then
    if jsonb_typeof(task_result->'applied') is distinct from 'string'
      or task_result->>'applied' !~ '^[A-Za-z0-9._-]+:[0-9]{1,5}$'
      then raise exception 'The applied proxy host:port is required'; end if;
    if exists(select 1 from jsonb_object_keys(task_result) k where k not in ('entries', 'applied'))
      then raise exception 'Unexpected result field'; end if;
  end if;
  update public.reporting_automation_tasks set status = 'succeeded', result = task_result,
    completed_at = clock_timestamp() where id = t.id;
  return true;
end $$;
