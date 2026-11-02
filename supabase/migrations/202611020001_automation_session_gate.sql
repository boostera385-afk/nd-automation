-- Browser tasks must obey the same explicit work-session boundary as checks.
-- Existing unbound pending tasks are cancelled, not silently authorized.
-- Apply only with operator approval; this file alone changes no hosted state.
alter table public.reporting_automation_tasks
  add column session_id uuid,
  add foreign key (organization_id, session_id)
    references public.reporting_work_sessions(organization_id, id);
create index automation_task_worker_fk on public.reporting_automation_tasks(organization_id, worker_id);
create index automation_task_session_fk on public.reporting_automation_tasks(organization_id, session_id);

update public.reporting_automation_tasks
  set status = 'cancelled', completed_at = clock_timestamp(),
      error = 'Task predates session authorization; queue it again in an active work session'
  where status = 'pending';

-- Retain the reviewed per-kind validation behind a non-exposed, revoked helper.
alter function public.reporting_enqueue_automation_task(uuid, uuid, text, text, jsonb)
  set schema private_reporting;
revoke all on function private_reporting.reporting_enqueue_automation_task(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

create function public.reporting_enqueue_automation_task(
  org uuid, worker uuid, kind text, summary text, payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; task uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  select s.id into sid from public.reporting_work_sessions s
    join auth.users u on u.id = s.user_id and u.email_confirmed_at is not null
    where s.organization_id = org and s.user_id = auth.uid() and s.status = 'active'
      and s.started_at > clock_timestamp() - interval '10 hours'
      and s.started_at <= clock_timestamp()
    for update of s;
  if sid is null then raise exception 'Start an active work session first'; end if;
  task := private_reporting.reporting_enqueue_automation_task(org, worker, kind, summary, payload);
  update public.reporting_automation_tasks set session_id = sid where id = task;
  return task;
end $$;
revoke all on function public.reporting_enqueue_automation_task(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reporting_enqueue_automation_task(uuid, uuid, text, text, jsonb)
  to authenticated;

create or replace function public.reporting_claim_automation_task(credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers; t public.reporting_automation_tasks;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id = w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at = clock_timestamp() where id = w.id;
  -- An expired lease remains a lock until a person reconciles it.
  if exists(select 1 from public.reporting_check_jobs where worker_id = w.id and status = 'leased')
    or exists(select 1 from public.reporting_publish_jobs where worker_id = w.id and status = 'leased')
    or exists(select 1 from public.reporting_automation_tasks where worker_id = w.id and status = 'leased')
    then return null; end if;
  -- Paused sessions retain their queue, but cannot dispatch. Closed/expired,
  -- unbound or revoked authorizations cannot be inherited by a new session.
  update public.reporting_automation_tasks q
    set status = 'cancelled', completed_at = clock_timestamp(),
        error = 'Task authorization ended; queue it again in an active work session'
    where q.worker_id = w.id and q.status = 'pending' and not exists (
      select 1 from public.reporting_work_sessions s
        join public.reporting_memberships m on m.organization_id = s.organization_id and m.user_id = s.user_id
        join auth.users u on u.id = s.user_id and u.email_confirmed_at is not null
        where s.id = q.session_id and s.organization_id = q.organization_id and s.user_id = q.created_by
          and s.status in ('active', 'paused') and m.role in ('owner', 'admin', 'operator')
          and s.started_at > clock_timestamp() - interval '10 hours' and s.started_at <= clock_timestamp());
  select q.* into t from public.reporting_automation_tasks q
    join public.reporting_work_sessions s on s.id = q.session_id and s.organization_id = q.organization_id
    join public.reporting_memberships m on m.organization_id = s.organization_id and m.user_id = s.user_id
    join auth.users u on u.id = s.user_id and u.email_confirmed_at is not null
    where q.worker_id = w.id and q.status = 'pending' and s.user_id = q.created_by
      and s.status = 'active' and m.role in ('owner', 'admin', 'operator')
      and s.started_at > clock_timestamp() - interval '10 hours' and s.started_at <= clock_timestamp()
    order by q.created_at, q.id for update of q, s skip locked limit 1;
  if t.id is null then return null; end if;
  update public.reporting_automation_tasks set status = 'leased', lease_token = gen_random_uuid(),
    leased_at = clock_timestamp(), lease_expires_at = clock_timestamp() + interval '10 minutes'
    where id = t.id returning * into t;
  return jsonb_build_object('task_id', t.id, 'kind', t.kind, 'payload', t.payload,
    'lease_token', t.lease_token, 'lease_expires_at', t.lease_expires_at);
end $$;

comment on column public.reporting_automation_tasks.session_id is
  'Exact human authorization for this task; pause blocks new claims, end/expiry revokes pending tasks. In-flight tasks may complete once.';
