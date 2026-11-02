-- Code-first only: bounded, explicit approved-revision scheduling/bulk queueing.
-- No cron, job creation, browser execution or existing authorization is enabled.
alter table public.reporting_publish_jobs
  add column not_before timestamptz not null default clock_timestamp(),
  add column dispatch_until timestamptz;
alter table public.reporting_publish_jobs add constraint reporting_publish_dispatch_window
  check (isfinite(not_before) and (dispatch_until is null or
    (isfinite(dispatch_until) and dispatch_until > not_before and dispatch_until <= not_before + interval '30 minutes')));
create index reporting_publish_due on public.reporting_publish_jobs(worker_id, not_before, id) where status='pending';

create function private_reporting.publish_batch_access(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private_reporting.is_staff(org) and exists(select 1 from auth.users u
    where u.id=auth.uid() and u.email_confirmed_at is not null)
$$;
revoke all on function private_reporting.publish_batch_access(uuid) from public, anon;
grant execute on function private_reporting.publish_batch_access(uuid) to authenticated;

create table public.reporting_publish_batches (
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  request_id uuid not null,
  entries jsonb not null check (jsonb_typeof(entries)='array' and jsonb_array_length(entries) between 1 and 20 and octet_length(entries::text)<=32768),
  result jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,request_id)
);
create index reporting_publish_batch_creator on public.reporting_publish_batches(created_by);
alter table public.reporting_publish_batches enable row level security;
create policy publish_batches_staff_read on public.reporting_publish_batches for select to authenticated
  using(private_reporting.publish_batch_access(organization_id));
revoke all on public.reporting_publish_batches from public, anon, authenticated;
grant select on public.reporting_publish_batches to authenticated;

create function public.reporting_enqueue_publish_batch(org uuid, request_id uuid, entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.reporting_publish_batches; s public.reporting_work_sessions;
  item jsonb; due timestamptz; until_ timestamptz; minutes_ int; jid uuid; ids uuid[] := '{}';
  result jsonb := '[]'::jsonb;
begin
  if not private_reporting.publish_batch_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if request_id is null or entries is null or jsonb_typeof(entries)<>'array'
    or jsonb_array_length(entries) not between 1 and 20 or octet_length(entries::text)>32768 then raise exception 'Invalid publish batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,20261103));
  if not private_reporting.publish_batch_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select * into prior from public.reporting_publish_batches b where b.organization_id=org and b.request_id=reporting_enqueue_publish_batch.request_id;
  if prior.request_id is not null then
    if prior.created_by is distinct from auth.uid() or prior.entries<>entries then raise exception 'Publish batch replay conflict'; end if;
    return prior.result; -- History replay is not a new authorization or a new job.
  end if;
  select * into s from public.reporting_work_sessions where organization_id=org and user_id=auth.uid()
    and status='active' and started_at<=clock_timestamp() and started_at>clock_timestamp()-interval '10 hours' for update;
  if s.id is null then raise exception 'Start an active work session first'; end if;
  -- Stable lock order avoids opposite draft-order deadlocks between bulk callers.
  for item in select value from jsonb_array_elements(entries) order by value->>'draftId' loop
    if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>4
      or not(item ?& array['draftId','revision','notBefore','windowMinutes'])
      or jsonb_typeof(item->'draftId')<>'string' or (item->>'draftId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'revision')<>'number' or (item->>'revision') !~ '^[1-9][0-9]{0,9}$'
      or (item->>'revision')::bigint>2147483647
      or jsonb_typeof(item->'windowMinutes')<>'number' or (item->>'windowMinutes') !~ '^[0-9]{1,2}$'
      or (item->>'windowMinutes')::int not between 5 and 30 then raise exception 'Invalid scheduled revision'; end if;
    if (item->>'draftId')::uuid=any(ids) then raise exception 'Duplicate draft in batch'; end if;
    ids := array_append(ids,(item->>'draftId')::uuid);
    if jsonb_typeof(item->'notBefore')='null' then due := clock_timestamp();
    elsif jsonb_typeof(item->'notBefore')='string' and item->>'notBefore' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      due := (item->>'notBefore')::timestamptz;
      if not isfinite(due) or due<clock_timestamp()-interval '5 seconds' or due>clock_timestamp()+interval '8 hours' then raise exception 'Schedule time outside permitted range'; end if;
    else raise exception 'Schedule requires an explicit zoned timestamp'; end if;
    minutes_ := (item->>'windowMinutes')::int;
    until_ := due + make_interval(mins=>minutes_);
    -- Reserve the entire 10-minute browser lease before the original session ends.
    if until_>s.started_at+interval '10 hours'-interval '10 minutes' then raise exception 'Schedule exceeds the current work session'; end if;
    jid := public.reporting_enqueue_publish(org,(item->>'draftId')::uuid,(item->>'revision')::int);
    update public.reporting_publish_jobs set not_before=due,dispatch_until=until_ where id=jid and organization_id=org and session_id=s.id;
    if not found then raise exception 'Scheduled session changed'; end if;
    result := result || jsonb_build_object('jobId',jid,'draftId',item->>'draftId','revision',(item->>'revision')::int,
      'notBefore',due,'dispatchUntil',until_);
  end loop;
  insert into public.reporting_publish_batches(organization_id,request_id,entries,result,created_by)
    values(org,request_id,entries,result,auth.uid());
  return result;
end $$;
revoke all on function public.reporting_enqueue_publish_batch(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reporting_enqueue_publish_batch(uuid,uuid,jsonb) to authenticated;

-- Keep the outer verified-session/browser-task exclusion wrapper in place. The
-- private claimant now also honors due/deadline; it remains non-callable by users.
create or replace function private_reporting.reporting_claim_publish(credential text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.reporting_workers; j public.reporting_publish_jobs;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  if exists(select 1 from public.reporting_check_jobs where worker_id=w.id and status='leased')
    or exists(select 1 from public.reporting_publish_jobs where worker_id=w.id and status='leased') then return null; end if;
  update public.reporting_publish_jobs q set status='cancelled', failure_notes='Dispatch window expired; no automatic catch-up or submission.'
    where q.worker_id=w.id and q.status='pending' and q.dispatch_until<=clock_timestamp();
  update public.reporting_publish_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and exists(
    select 1 from public.reporting_work_sessions s where s.id=q.session_id and (s.status='closed' or s.started_at<=clock_timestamp()-interval '10 hours'));
  update public.reporting_publish_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and not exists(
    select 1 from public.reporting_content_drafts d join public.reporting_worker_profiles b on b.id=q.binding_id and b.organization_id=q.organization_id
    where d.id=q.draft_id and d.organization_id=q.organization_id and d.status='approved' and d.revision=q.draft_revision
      and d.content=q.content_snapshot and q.target_snapshot=jsonb_build_object('binding_id',b.id,'customer_id',b.customer_id,
        'worker_id',b.worker_id,'profile_id',b.profile_id,'account_label',b.account_label));
  select q.* into j from public.reporting_publish_jobs q
    join public.reporting_work_sessions s on s.id=q.session_id and s.organization_id=q.organization_id
    join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
    where q.worker_id=w.id and q.status='pending' and q.not_before<=clock_timestamp()
      and (q.dispatch_until is null or q.dispatch_until>clock_timestamp())
      and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')
    order by q.not_before,q.created_at,q.id for update of q skip locked limit 1;
  if j.id is null then return null; end if;
  update public.reporting_publish_jobs set status='leased',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '10 minutes'
    where id=j.id returning * into j;
  return j.content_snapshot || jsonb_build_object('job_id',j.id,'draft_id',j.draft_id,'draft_revision',j.draft_revision,
    'customer_id',j.target_snapshot->>'customer_id','profile_id',j.target_snapshot->>'profile_id','account_label',j.target_snapshot->>'account_label',
    'lease_token',j.lease_token,'lease_expires_at',j.lease_expires_at);
end $$;
revoke all on function private_reporting.reporting_claim_publish(text) from public,anon,authenticated;

create function public.reporting_publish_scheduling_version() returns integer
language sql stable security invoker set search_path='' as $$ select 1; $$;
revoke all on function public.reporting_publish_scheduling_version() from public,anon,authenticated;
grant execute on function public.reporting_publish_scheduling_version() to authenticated;
notify pgrst,'reload schema';
