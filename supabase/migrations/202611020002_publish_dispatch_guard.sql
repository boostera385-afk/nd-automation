-- Supervised publishing must serialize against browser tasks as well as checks.
-- Preserve deployed approval/revision/result contracts; add exact verified
-- session ownership and a future-clock guard before the existing claimant runs.
alter function public.reporting_claim_publish(text) set schema private_reporting;
revoke all on function private_reporting.reporting_claim_publish(text) from public, anon, authenticated;

create function public.reporting_claim_publish(credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id = w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  if exists(select 1 from public.reporting_automation_tasks where worker_id = w.id and status = 'leased')
    then return null; end if;
  update public.reporting_publish_jobs q set status = 'cancelled'
    where q.worker_id = w.id and q.status = 'pending' and not exists (
      select 1 from public.reporting_work_sessions s
        join auth.users u on u.id = s.user_id and u.email_confirmed_at is not null
        join public.reporting_memberships m on m.organization_id = s.organization_id and m.user_id = s.user_id
        where s.id = q.session_id and s.organization_id = q.organization_id and s.user_id = q.created_by
          and s.status in ('active', 'paused') and s.started_at <= clock_timestamp()
          and s.started_at > clock_timestamp() - interval '10 hours'
          and m.role in ('owner', 'admin', 'operator'));
  return private_reporting.reporting_claim_publish(credential);
end $$;
revoke all on function public.reporting_claim_publish(text) from public, anon, authenticated;
grant execute on function public.reporting_claim_publish(text) to anon, authenticated;

-- A lightweight UI deployment check. It exposes no job or account data.
create function public.reporting_publisher_protocol_version() returns integer
language sql stable security invoker set search_path = '' as $$ select 1; $$;
revoke all on function public.reporting_publisher_protocol_version() from public, anon, authenticated;
grant execute on function public.reporting_publisher_protocol_version() to authenticated;
notify pgrst, 'reload schema';
