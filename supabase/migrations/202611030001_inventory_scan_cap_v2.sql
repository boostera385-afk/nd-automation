-- Inventory auto-detect, v2: raise the per-scan cap from 500 rows to 5,000.
--
-- A real Incogniton install returns thousands of profiles. The 500-row ceiling
-- (and the 64 KB result budget that bound it even earlier) forced operators to
-- import the rest by CSV. 5,000 matches the limit already enforced by
-- public.reporting_import_profiles, so a stored scan can never exceed what the
-- inventory importer accepts. Row shape, field allowlists, the truncation
-- requirement and the 8 KB general result cap are unchanged; only this one task
-- kind gets the larger allowance.
--
-- browser_task_receipts_v1 (202611020006) moved the implementation into
-- private_reporting and left public.reporting_complete_automation_task as an
-- identical-replay guard, so the body is replaced there. Its ACL is unchanged
-- (no PUBLIC/anon/authenticated execute; the public wrapper calls it).
create or replace function private_reporting.reporting_complete_automation_task(
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
  -- A scan result legitimately carries up to 5,000 inventory rows, so only this
  -- kind gets the larger allowance; every other result stays under 8000 bytes.
  if task_result is null or jsonb_typeof(task_result) <> 'object'
    or (t.kind <> 'inventory_scan' and pg_column_size(task_result) > 8000)
    or (t.kind = 'inventory_scan' and pg_column_size(task_result) > 1000000)
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
      or jsonb_array_length(task_result->'profiles') > 5000
      or jsonb_typeof(task_result->'total') is distinct from 'number'
      or (task_result->>'total')::numeric < 0
      or jsonb_typeof(task_result->'truncated') is distinct from 'boolean'
      then raise exception 'A scan requires a capped profile list, a total and a truncation flag'; end if;
    if (task_result->>'total')::numeric > 5000 and (task_result->>'truncated')::boolean is not true
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

revoke all on function private_reporting.reporting_complete_automation_task(text, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
