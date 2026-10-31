-- Browser task queue, v1. Additive and reversible: one new table plus RPCs.
-- Executes only what the local worker can do without a Nextdoor session:
-- Incogniton profile creation, read-only preset inventory, and local
-- cookie/proxy file validation. Posting, listings and account creation are
-- deliberately absent from the kind allowlist; they remain gated.
create table public.reporting_automation_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  worker_id uuid not null,
  kind text not null check (kind in ('profile_create', 'preset_snapshot', 'cookie_import', 'proxy_import')),
  status text not null default 'pending' check (status in ('pending', 'leased', 'succeeded', 'failed', 'cancelled')),
  summary text not null check (char_length(summary) between 1 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  lease_token uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, worker_id) references public.reporting_workers(organization_id, id)
);
create index automation_task_worker_queue on public.reporting_automation_tasks(worker_id, status, created_at);
create index automation_task_org on public.reporting_automation_tasks(organization_id, created_at desc);
create unique index automation_one_open_task on public.reporting_automation_tasks(worker_id)
  where status in ('pending', 'leased');

alter table public.reporting_automation_tasks enable row level security;
create policy automation_task_staff_read on public.reporting_automation_tasks for select to authenticated
  using (private_reporting.is_staff(organization_id));
revoke all on public.reporting_automation_tasks from public, anon, authenticated;
grant select on public.reporting_automation_tasks to authenticated;

create function public.reporting_enqueue_automation_task(
  org uuid, worker uuid, kind text, summary text, payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare task uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if kind is null or kind not in ('profile_create', 'preset_snapshot', 'cookie_import', 'proxy_import')
    then raise exception 'This task type is not executable from the dashboard'; end if;
  if summary is null or char_length(trim(summary)) not between 1 and 200 then raise exception 'A short summary is required'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' or pg_column_size(payload) > 8000
    then raise exception 'Invalid task payload'; end if;
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('name', 'group', 'os', 'path', 'note'))
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
  end if;
  if not exists(select 1 from public.reporting_workers where id = worker and organization_id = org and enabled)
    then raise exception 'Worker unavailable'; end if;
  if exists(select 1 from public.reporting_automation_tasks where worker_id = worker and status in ('pending', 'leased'))
    then raise exception 'This laptop already has a queued or running browser task. Wait for it to finish.'; end if;
  insert into public.reporting_automation_tasks(organization_id, worker_id, kind, summary, payload, created_by)
    values (org, worker, kind, trim(summary), payload, auth.uid()) returning id into task;
  return task;
end $$;

create function public.reporting_cancel_automation_task(org uuid, task uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  update public.reporting_automation_tasks set status = 'cancelled', completed_at = clock_timestamp()
    where id = task and organization_id = org and status = 'pending';
  if not found then raise exception 'Only a pending task can be cancelled'; end if;
end $$;

create function public.reporting_reconcile_expired_automation_task(org uuid, task uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  update public.reporting_automation_tasks set status = 'cancelled', lease_token = null,
    completed_at = clock_timestamp(), error = 'Expired lease reconciled by staff'
    where id = task and organization_id = org and status = 'leased' and lease_expires_at < clock_timestamp();
  if not found then raise exception 'Only an expired lease can be reconciled'; end if;
end $$;

create function public.reporting_claim_automation_task(credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers; t public.reporting_automation_tasks;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id = w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at = clock_timestamp() where id = w.id;
  -- One browser operation at a time per laptop, across every job family.
  if exists(select 1 from public.reporting_check_jobs where worker_id = w.id and status = 'leased')
    or exists(select 1 from public.reporting_publish_jobs where worker_id = w.id and status = 'leased')
    or exists(select 1 from public.reporting_automation_tasks where worker_id = w.id and status = 'leased')
    then return null; end if;
  select q.* into t from public.reporting_automation_tasks q
    where q.worker_id = w.id and q.status = 'pending'
    order by q.created_at, q.id for update of q skip locked limit 1;
  if t.id is null then return null; end if;
  update public.reporting_automation_tasks set status = 'leased', lease_token = gen_random_uuid(),
    leased_at = clock_timestamp(), lease_expires_at = clock_timestamp() + interval '10 minutes'
    where id = t.id returning * into t;
  return jsonb_build_object('task_id', t.id, 'kind', t.kind, 'payload', t.payload,
    'lease_token', t.lease_token, 'lease_expires_at', t.lease_expires_at);
end $$;

create function public.reporting_complete_automation_task(
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
  if task_result is null or jsonb_typeof(task_result) <> 'object' or pg_column_size(task_result) > 8000
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
  elsif t.kind in ('cookie_import', 'proxy_import') then
    if jsonb_typeof(task_result->'entries') is distinct from 'number' then raise exception 'An entry count is required'; end if;
    if exists(select 1 from jsonb_object_keys(task_result) k where k not in ('entries', 'with_credentials', 'domains', 'sample', 'note'))
      then raise exception 'Unexpected result field'; end if;
  end if;
  update public.reporting_automation_tasks set status = 'succeeded', result = task_result,
    completed_at = clock_timestamp() where id = t.id;
  return true;
end $$;

-- The monitoring claim must respect automation leases too, or two browser
-- operations could overlap on the same laptop.
create or replace function public.reporting_claim_check(credential text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare w public.reporting_workers; j public.reporting_check_jobs; post_url text; post_title text; post_label text;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  -- One browser operation at a time per worker, across every job family.
  if exists(select 1 from public.reporting_check_jobs where worker_id=w.id and status='leased')
     or exists(select 1 from public.reporting_publish_jobs where worker_id=w.id and status='leased')
     or exists(select 1 from public.reporting_automation_tasks where worker_id=w.id and status='leased') then return null; end if;
  update public.reporting_check_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and exists(
    select 1 from public.reporting_work_sessions s where s.id=q.session_id and (s.status='closed' or s.started_at<=clock_timestamp()-interval '10 hours'));
  insert into public.reporting_check_jobs(organization_id,worker_id,binding_id,publication_id,session_id,profile_id)
    select b.organization_id,b.worker_id,b.id,p.id,s.id,b.profile_id
    from public.reporting_worker_profiles b
    join public.reporting_work_sessions s on s.id=b.monitoring_session_id and s.organization_id=b.organization_id
    join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
    join public.reporting_publications p on p.organization_id=b.organization_id and p.customer_id=b.customer_id and p.account_label=b.account_label
    join public.reporting_customers c on c.id=b.customer_id and c.organization_id=b.organization_id
    where b.worker_id=w.id and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')
      and (
        p.last_checked_at is null
        or p.last_checked_at<clock_timestamp()-interval '24 hours'
        or (p.last_check_outcome in ('proxy_issue','network_error','profile_error')
            and p.last_checked_at<clock_timestamp()-interval '30 minutes'
            and (select count(*) from public.reporting_post_checks x where x.publication_id=p.id
                   and x.checked_at>clock_timestamp()-interval '24 hours') < 6)
      )
      and (p.published_at is null or (p.published_at at time zone c.time_zone)::date < (clock_timestamp() at time zone c.time_zone)::date)
      and p.url ~ '^https://(www[.])?nextdoor[.]com/(p|for_sale_and_free)/[A-Za-z0-9_-]+$'
      and not exists(select 1 from public.reporting_check_jobs q where q.publication_id=p.id and q.status in ('pending','leased'))
    order by p.created_at,p.id limit 100 on conflict do nothing;
  select q.* into j from public.reporting_check_jobs q
    join public.reporting_work_sessions s on s.id=q.session_id and s.organization_id=q.organization_id
    join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
    where q.worker_id=w.id and q.status='pending' and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')
    order by q.created_at,q.id for update of q skip locked limit 1;
  if j.id is null then return null; end if;
  update public.reporting_check_jobs set status='leased',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '10 minutes'
    where id=j.id returning * into j;
  select url, title, account_label into post_url, post_title, post_label from public.reporting_publications where id=j.publication_id and organization_id=j.organization_id;
  return jsonb_build_object('job_id',j.id,'publication_id',j.publication_id,'profile_id',j.profile_id,'url',post_url,
    'lease_token',j.lease_token,'lease_expires_at',j.lease_expires_at,'title',post_title,'account_label',post_label);
end $function$;

revoke all on function public.reporting_enqueue_automation_task(uuid,uuid,text,text,jsonb),
  public.reporting_cancel_automation_task(uuid,uuid),
  public.reporting_reconcile_expired_automation_task(uuid,uuid),
  public.reporting_claim_automation_task(text),
  public.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.reporting_enqueue_automation_task(uuid,uuid,text,text,jsonb),
  public.reporting_cancel_automation_task(uuid,uuid),
  public.reporting_reconcile_expired_automation_task(uuid,uuid) to authenticated;
grant execute on function public.reporting_claim_automation_task(text),
  public.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text) to anon, authenticated;
notify pgrst, 'reload schema';
