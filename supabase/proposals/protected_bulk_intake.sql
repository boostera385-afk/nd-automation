-- Local candidate, NOT applied. Generate/review a migration before deployment.
-- Only ciphertext paths/UUIDs enter tasks. No cookie/proxy values or auto-watch.
create table public.reporting_intake_batches (
  id uuid primary key,
  organization_id uuid not null references public.reporting_organizations(id),
  worker_id uuid not null,
  session_id uuid not null,
  created_by uuid not null references auth.users(id),
  rows jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id,worker_id) references public.reporting_workers(organization_id,id),
  foreign key (organization_id,session_id) references public.reporting_work_sessions(organization_id,id),
  unique(organization_id,id)
);
create index reporting_intake_worker on public.reporting_intake_batches(organization_id,worker_id);
create index reporting_intake_session on public.reporting_intake_batches(organization_id,session_id);
create index reporting_intake_creator on public.reporting_intake_batches(created_by);
alter table public.reporting_intake_batches enable row level security;
revoke all on public.reporting_intake_batches from public,anon,authenticated;
grant select on public.reporting_intake_batches to authenticated;
create policy intake_batch_read on public.reporting_intake_batches for select to authenticated using(private_reporting.is_staff(organization_id));
alter table public.reporting_automation_tasks add column intake_batch_id uuid,
  add column intake_customer_id uuid,
  add foreign key (organization_id,intake_batch_id) references public.reporting_intake_batches(organization_id,id),
  add foreign key (organization_id,intake_customer_id) references public.reporting_customers(organization_id,id);
create index reporting_intake_task_batch on public.reporting_automation_tasks(organization_id,intake_batch_id,status);
create index reporting_intake_task_customer on public.reporting_automation_tasks(organization_id,intake_customer_id);
-- Bulk intake intentionally queues several pending rows for one worker while
-- execution stays one-at-a-time: each claim path takes a FOR UPDATE lock on
-- the worker row and refuses when any task is leased, and every enqueue RPC
-- (single task, supervised workflow, intake batch) refuses while any task is
-- open. Narrow the single-open-task backstop to non-batch rows so batch rows
-- may queue without weakening any of those worker-lock guarantees.
drop index public.automation_one_open_task;
create unique index automation_one_open_task on public.reporting_automation_tasks(worker_id)
  where status in ('pending','leased') and intake_batch_id is null;

create function public.reporting_enqueue_intake_batch(org uuid,worker uuid,request_id uuid,records jsonb,permitted boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid; existing public.reporting_intake_batches; row jsonb; customer uuid;
begin
  if not private_reporting.is_staff(org) or permitted is distinct from true then raise exception 'Explicit permitted-use authorization required'; end if;
  if request_id is null or records is null or jsonb_typeof(records)<>'array' or jsonb_array_length(records) not between 1 and 100
    or pg_column_size(records)>100000 then raise exception 'Expected 1-100 protected intake rows'; end if;
  perform pg_advisory_xact_lock(hashtextextended('intake:' || request_id::text,0));
  select * into existing from public.reporting_intake_batches where id=request_id;
  if existing.id is not null then
    if existing.organization_id<>org or existing.worker_id<>worker or existing.created_by<>auth.uid() or existing.rows<>records
      then raise exception 'Request identity conflict'; end if;
    return existing.id; -- Receipt lookup, never requeue after a timeout.
  end if;
  perform 1 from public.reporting_workers where id=worker and organization_id=org and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  select s.id into sid from public.reporting_work_sessions s where s.organization_id=org and s.user_id=auth.uid()
    and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and s.started_at<=clock_timestamp() for update;
  if sid is null then raise exception 'Start an active work session first'; end if;
  if exists(select 1 from public.reporting_automation_tasks where worker_id=worker and status in ('pending','leased'))
    then raise exception 'Resolve existing queued tasks first'; end if;
  if exists(select 1 from jsonb_array_elements(records) r group by r->>'profile_id',r->>'kind' having count(*)>1)
    then raise exception 'Duplicate profile/type mapping'; end if;
  insert into public.reporting_intake_batches(id,organization_id,worker_id,session_id,created_by,rows)
    values(request_id,org,worker,sid,auth.uid(),records);
  for row in select value from jsonb_array_elements(records) loop
    if jsonb_typeof(row)<>'object' or not(row ?& array['profile_id','kind','replace','path']) or
      exists(select 1 from jsonb_object_keys(row) k where k not in ('profile_id','kind','replace','path')) or
      jsonb_typeof(row->'profile_id') is distinct from 'string' or row->>'profile_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or
      row->>'kind' is null or row->>'kind' not in ('cookie_write','proxy_write') or jsonb_typeof(row->'replace') is distinct from 'boolean' or
      (row->>'kind'='proxy_write' and (row->>'replace')::boolean) or jsonb_typeof(row->'path') is distinct from 'string' or
      char_length(row->>'path') not between 3 and 400 or row->>'path' !~ '[a-f0-9-]{36}[.]private[.]bin$' or
      row->>'path' ~ '[[:cntrl:]]' then raise exception 'Invalid protected intake descriptor'; end if;
    select p.customer_id into customer from public.reporting_worker_profiles p where p.organization_id=org
      and p.worker_id=worker and p.profile_id=(row->>'profile_id')::uuid;
    if customer is null then raise exception 'Exact customer/profile binding required'; end if;
    insert into public.reporting_automation_tasks(organization_id,worker_id,kind,summary,payload,created_by,session_id,intake_batch_id,intake_customer_id)
      values(org,worker,row->>'kind','Explicit protected bulk intake',row-'kind',auth.uid(),sid,request_id,customer);
  end loop;
  return request_id;
end $$;

create function private_reporting.guard_intake_dispatch() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.intake_batch_id is null or new.status<>'leased' or old.status='leased' then return new; end if;
  if exists(select 1 from public.reporting_automation_tasks where organization_id=new.organization_id
    and intake_batch_id=new.intake_batch_id and status in ('failed','cancelled')) then raise exception 'Bulk intake stopped on failure/cancellation; reconcile the batch'; end if;
  if not exists(select 1 from public.reporting_worker_profiles p where p.organization_id=new.organization_id
    and p.worker_id=new.worker_id and p.profile_id=(new.payload->>'profile_id')::uuid and p.customer_id=new.intake_customer_id)
    then raise exception 'Bulk intake assignment changed; reconcile before dispatch'; end if;
  return new;
end $$;
create trigger reporting_intake_dispatch before update of status on public.reporting_automation_tasks
  for each row execute function private_reporting.guard_intake_dispatch();
revoke all on function private_reporting.guard_intake_dispatch() from public,anon,authenticated;
revoke all on function public.reporting_enqueue_intake_batch(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.reporting_enqueue_intake_batch(uuid,uuid,uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
