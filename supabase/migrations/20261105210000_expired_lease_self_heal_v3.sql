-- Final expired-lease self-heal (v3): supersedes the same-day v1 and v2.
--
-- v1 allowed a fresh claim in the same call as the release, which crossed the
-- existing "no automatic retry of expired claims" acceptance contract.
-- v2 replayed the pre-supervised-workflows body for the public task claim and
-- dropped the supervised/normal split: the real claimant has lived in
-- private_reporting.claim_browser_task(credential, supervised) since
-- 202611020007, with its session gates, stale-authorization cleanup and
-- workflow-target checks. This v3 patches THAT function, keeps every gate,
-- and restores the two public wrappers.
--
-- Rule: this worker's expired check/task leases are cancelled (exactly the
-- state the manual reconciliation buttons write), and that call then returns
-- null. The expired claim is never retried automatically; the next worker
-- poll (~15 s) plans and claims fresh due work, so one crashed run can no
-- longer pin the laptop's queue until a person clicks the dashboard button.
-- Publish leases stay manual: an expired submit completes as
-- `needs_reconciliation` and always requires an operator.

create or replace function private_reporting.claim_browser_task(credential text, supervised boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare w public.reporting_workers; t public.reporting_automation_tasks;
  released integer := 0; rel integer;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  -- Self-healing release of this worker's expired check/task leases. Same
  -- state the manual reconciliation functions write; then return null so an
  -- expired claim is never retried within the same call.
  update public.reporting_check_jobs set status='cancelled', lease_token=null
    where worker_id=w.id and status='leased' and lease_expires_at<clock_timestamp();
  get diagnostics rel = row_count; released := released + rel;
  update public.reporting_automation_tasks set status='cancelled', lease_token=null,
        completed_at=clock_timestamp(), error='Expired lease released at the next claim'
    where worker_id=w.id and status='leased' and lease_expires_at<clock_timestamp();
  get diagnostics rel = row_count; released := released + rel;
  if released > 0 then return null; end if;
  if exists(select 1 from public.reporting_check_jobs where worker_id=w.id and status='leased')
    or exists(select 1 from public.reporting_publish_jobs where worker_id=w.id and status='leased')
    or exists(select 1 from public.reporting_automation_tasks where worker_id=w.id and status='leased') then return null; end if;
  update public.reporting_automation_tasks q set status='cancelled',completed_at=clock_timestamp(),error='Task authorization ended; reconcile before creating a new request'
    where q.worker_id=w.id and q.status='pending' and not exists(select 1 from public.reporting_work_sessions s
      join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
      join auth.users u on u.id=s.user_id and u.email_confirmed_at is not null
      where s.id=q.session_id and s.organization_id=q.organization_id and s.user_id=q.created_by
        and s.status in ('active','paused') and m.role in ('owner','admin','operator')
        and s.started_at>clock_timestamp()-interval '10 hours' and s.started_at<=clock_timestamp());
  update public.reporting_automation_tasks q set status='cancelled',completed_at=clock_timestamp(),error='Workflow target changed; review again'
    where q.worker_id=w.id and q.status='pending' and q.kind='supervised_workflow'
      and not private_reporting.workflow_target_current(q.organization_id,w.id,q.payload);
  select q.* into t from public.reporting_automation_tasks q join public.reporting_work_sessions s
    on s.id=q.session_id and s.organization_id=q.organization_id
    where q.worker_id=w.id and q.status='pending' and (q.kind='supervised_workflow')=supervised
      and s.status='active' and s.started_at>clock_timestamp()-interval '9 hours 50 minutes'
    order by q.created_at,q.id for update of q,s skip locked limit 1;
  if t.id is null then return null; end if;
  update public.reporting_automation_tasks set status='leased',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),
    lease_expires_at=clock_timestamp()+interval '10 minutes' where id=t.id returning * into t;
  return jsonb_build_object('task_id',t.id,'kind',t.kind,'payload',t.payload,'lease_token',t.lease_token,'lease_expires_at',t.lease_expires_at);
end $$;
revoke all on function private_reporting.claim_browser_task(text,boolean) from public,anon,authenticated;

create or replace function public.reporting_claim_automation_task(credential text) returns jsonb
language sql security definer set search_path to '' as $$ select private_reporting.claim_browser_task(credential,false); $$;
create or replace function public.reporting_claim_supervised_workflow(credential text) returns jsonb
language sql security definer set search_path to '' as $$ select private_reporting.claim_browser_task(credential,true); $$;
revoke all on function public.reporting_claim_automation_task(text),public.reporting_claim_supervised_workflow(text) from public,anon,authenticated;
grant execute on function public.reporting_claim_automation_task(text),public.reporting_claim_supervised_workflow(text) to anon,authenticated;
