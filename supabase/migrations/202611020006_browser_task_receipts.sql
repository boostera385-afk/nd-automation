-- Identical completion replay only. A cancelled/reconciled lease is never a
-- receipt for an unrecorded action, and changed results cannot silently pass.
alter function public.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text)
  set schema private_reporting;
revoke all on function private_reporting.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;

create function public.reporting_complete_automation_task(
  credential text, task uuid, lease uuid, status text, task_result jsonb, task_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare w public.reporting_workers; t public.reporting_automation_tasks;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  select * into t from public.reporting_automation_tasks where id=task and worker_id=w.id for update;
  if t.id is null or lease is null or t.lease_token is distinct from lease then raise exception 'Invalid lease'; end if;
  if t.status in ('succeeded','failed') then
    if t.status is distinct from status or t.result is distinct from task_result
      or t.error is distinct from (case when task_error is null then null else trim(task_error) end)
      then raise exception 'Browser task completion replay conflict'; end if;
    return false;
  end if;
  if t.status='cancelled' then raise exception 'Task was reconciled or cancelled; receipt not recorded'; end if;
  return private_reporting.reporting_complete_automation_task(credential,task,lease,status,task_result,task_error);
end $$;
revoke all on function public.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text) to anon,authenticated;
notify pgrst,'reload schema';
