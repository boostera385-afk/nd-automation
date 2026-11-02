-- Explicit one-step account/content workflows, claimed only by a separate runner.
-- No secrets, executable selectors, background signup or synthetic identities.
alter table public.reporting_automation_tasks drop constraint reporting_automation_tasks_kind_check;
alter table public.reporting_automation_tasks add constraint reporting_automation_tasks_kind_check check
  (kind in ('profile_create','preset_snapshot','inventory_scan','cookie_import','proxy_import','cookie_write','proxy_write','supervised_workflow'));

create function private_reporting.valid_workflow_manifest(m jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if m is null or jsonb_typeof(m)<>'object' or octet_length(m::text)>5000
    or (select count(*) from jsonb_object_keys(m))<>12
    or not(m ?& array['version','operation','binding_id','profile_id','customer_id','account_label','account_url','target_url','expected_body_sha256','draft_id','draft_revision','consent'])
    or m->'version'<>'1'::jsonb or m->'consent'<>'true'::jsonb
    or m->>'operation' not in ('account_register','account_login','account_inspect','profile_browse','post_edit','post_delete','account_block')
    or jsonb_typeof(m->'operation')<>'string' then return false; end if;
  if exists(select 1 from unnest(array['binding_id','profile_id','customer_id']) k where
    jsonb_typeof(m->k)<>'string' or m->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or jsonb_typeof(m->'account_label')<>'string' or char_length(trim(m->>'account_label')) not between 1 and 120 then return false; end if;
  if m->>'operation'='account_register' then
    if m->'account_url'<>'null'::jsonb then return false; end if;
  elsif jsonb_typeof(m->'account_url')<>'string' or m->>'account_url' !~ '^https://nextdoor[.]com/profile/[A-Za-z0-9_-]+/?$' then return false; end if;
  if m->>'operation' in ('post_edit','post_delete') then
    if jsonb_typeof(m->'target_url')<>'string' or m->>'target_url' !~ '^https://nextdoor[.]com/(p|for_sale_and_free)/[A-Za-z0-9_-]+$'
      or jsonb_typeof(m->'expected_body_sha256')<>'string' or m->>'expected_body_sha256' !~ '^[a-f0-9]{64}$' then return false; end if;
  elsif m->>'operation'='account_block' then
    if jsonb_typeof(m->'target_url')<>'string' or m->>'target_url' !~ '^https://nextdoor[.]com/profile/[A-Za-z0-9_-]+/?$'
      or m->>'target_url'=m->>'account_url' or m->'expected_body_sha256'<>'null'::jsonb then return false; end if;
  elsif m->'target_url'<>'null'::jsonb or m->'expected_body_sha256'<>'null'::jsonb then return false; end if;
  if m->>'operation'='post_edit' then
    if jsonb_typeof(m->'draft_id')<>'string' or m->>'draft_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(m->'draft_revision')<>'number' or m->>'draft_revision' !~ '^[1-9][0-9]{0,8}$' then return false; end if;
  elsif m->'draft_id'<>'null'::jsonb or m->'draft_revision'<>'null'::jsonb then return false; end if;
  return true;
end $$;
revoke all on function private_reporting.valid_workflow_manifest(jsonb) from public,anon,authenticated;

create function private_reporting.workflow_target_current(org uuid, worker uuid, payload jsonb) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.reporting_worker_profiles b where b.organization_id=org and b.worker_id=worker
    and b.id=(payload->'manifest'->>'binding_id')::uuid and b.profile_id=(payload->'manifest'->>'profile_id')::uuid
    and b.customer_id=(payload->'manifest'->>'customer_id')::uuid and b.account_label=payload->'manifest'->>'account_label')
    and (payload->'manifest'->>'operation'<>'post_edit' or exists(select 1 from public.reporting_content_drafts d
      where d.organization_id=org and d.id=(payload->'manifest'->>'draft_id')::uuid
        and d.binding_id=(payload->'manifest'->>'binding_id')::uuid and d.status='approved'
        and d.revision=(payload->'manifest'->>'draft_revision')::int and d.content=payload->'content'
        and exists(select 1 from public.reporting_content_revisions r where r.organization_id=org and r.draft_id=d.id and r.revision=d.revision and r.event='approved'
          and r.target->>'worker_id'=worker::text and r.target->>'profile_id'=payload->'manifest'->>'profile_id'
          and r.target->>'customer_id'=payload->'manifest'->>'customer_id' and r.target->>'account_label'=payload->'manifest'->>'account_label')))
    and (payload->'manifest'->>'operation' not in ('post_edit','post_delete') or exists(select 1 from public.reporting_publications p
      where p.organization_id=org and p.customer_id=(payload->'manifest'->>'customer_id')::uuid
        and p.account_label=payload->'manifest'->>'account_label' and p.url=payload->'manifest'->>'target_url'))
$$;
revoke all on function private_reporting.workflow_target_current(uuid,uuid,jsonb) from public,anon,authenticated;

create function public.reporting_enqueue_supervised_workflow(org uuid, request_id uuid, manifest jsonb, destructive_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.reporting_worker_profiles; s public.reporting_work_sessions; prior public.reporting_automation_tasks;
  d public.reporting_content_drafts; content_ jsonb := 'null'::jsonb; payload_ jsonb;
begin
  if not private_reporting.is_staff(org) or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
    then raise exception 'Verified staff required' using errcode='42501'; end if;
  if request_id is null or not private_reporting.valid_workflow_manifest(manifest) then raise exception 'Invalid workflow manifest'; end if;
  if manifest->>'operation' in ('post_delete','account_block') and destructive_confirmed is distinct from true
    then raise exception 'Exact destructive target confirmation required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,20261107));
  select * into prior from public.reporting_automation_tasks where id=request_id;
  if prior.id is not null then
    if prior.organization_id<>org or prior.created_by is distinct from auth.uid() or prior.kind<>'supervised_workflow'
      or prior.payload->'manifest'<>manifest then raise exception 'Workflow request replay conflict'; end if;
    return prior.id;
  end if;
  select * into s from public.reporting_work_sessions where organization_id=org and user_id=auth.uid() and status='active'
    and started_at<=clock_timestamp() and started_at>clock_timestamp()-interval '9 hours 50 minutes' for update;
  if s.id is null then raise exception 'Start an active work session with ten minutes remaining'; end if;
  select * into b from public.reporting_worker_profiles where organization_id=org and id=(manifest->>'binding_id')::uuid for share;
  if b.id is null then raise exception 'Assignment unavailable'; end if;
  perform 1 from public.reporting_workers where id=b.worker_id and organization_id=org and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  if manifest->>'operation'='post_edit' then
    select * into d from public.reporting_content_drafts where organization_id=org and id=(manifest->>'draft_id')::uuid for share;
    if d.id is null or d.binding_id<>b.id or d.status<>'approved' or d.revision<>(manifest->>'draft_revision')::int
      or jsonb_array_length(coalesce(d.content->'media','[]'::jsonb))<>0 then raise exception 'Current approved text-edit revision required'; end if;
    if (d.content->>'kind'='post')<>(manifest->>'target_url' ~ '/p/') then raise exception 'Edit kind mismatch'; end if;
    content_ := d.content;
  end if;
  payload_ := jsonb_build_object('manifest',manifest,'content',content_);
  if not private_reporting.workflow_target_current(org,b.worker_id,payload_) then raise exception 'Exact workflow target changed or unavailable'; end if;
  if manifest->>'operation' in ('account_register','post_edit','post_delete','account_block') and exists(
    select 1 from public.reporting_automation_tasks q where q.organization_id=org and q.kind='supervised_workflow'
      and q.payload->'manifest'=manifest and (q.leased_at is not null or q.status='pending'))
    then raise exception 'This exact workflow already has claimed or pending work; reconcile rather than repeat'; end if;
  if exists(select 1 from public.reporting_automation_tasks where worker_id=b.worker_id and status in ('pending','leased'))
    then raise exception 'Worker already has a browser task'; end if;
  insert into public.reporting_automation_tasks(id,organization_id,worker_id,session_id,kind,summary,payload,created_by)
    values(request_id,org,b.worker_id,s.id,'supervised_workflow',manifest->>'operation',payload_,auth.uid());
  return request_id;
end $$;
revoke all on function public.reporting_enqueue_supervised_workflow(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.reporting_enqueue_supervised_workflow(uuid,uuid,jsonb,boolean) to authenticated;

-- Preserve the existing claimant/serialization/session checks, adding a locally
-- scoped capability selector. Normal agents never receive supervised workflows.
alter function public.reporting_claim_automation_task(text) set schema private_reporting;
revoke all on function private_reporting.reporting_claim_automation_task(text) from public,anon,authenticated;
create function private_reporting.claim_browser_task(credential text, supervised boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.reporting_workers; t public.reporting_automation_tasks;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
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
create function public.reporting_claim_automation_task(credential text) returns jsonb
language sql security definer set search_path='' as $$ select private_reporting.claim_browser_task(credential,false); $$;
create function public.reporting_claim_supervised_workflow(credential text) returns jsonb
language sql security definer set search_path='' as $$ select private_reporting.claim_browser_task(credential,true); $$;
revoke all on function public.reporting_claim_automation_task(text),public.reporting_claim_supervised_workflow(text) from public,anon,authenticated;
grant execute on function public.reporting_claim_automation_task(text),public.reporting_claim_supervised_workflow(text) to anon,authenticated;

-- Validate the one-step outcome at the table boundary, including a strict
-- redacted result shape. A handoff is not a created account or completed action.
create function private_reporting.validate_workflow_result() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.kind='supervised_workflow' and new.status='succeeded' then
    if jsonb_typeof(new.result)<>'object' or (select count(*) from jsonb_object_keys(new.result))<>6
      or not(new.result ?& array['operation','outcome','action_attempted','cleanup_confirmed','adapter_sha256','observed_at'])
      or new.result->>'operation' is distinct from new.payload->'manifest'->>'operation'
      or new.result->>'outcome' not in ('verified','handoff_required','needs_reconciliation','validation_error','profile_error')
      or jsonb_typeof(new.result->'outcome')<>'string'
      or jsonb_typeof(new.result->'action_attempted')<>'boolean' or jsonb_typeof(new.result->'cleanup_confirmed')<>'boolean'
      or jsonb_typeof(new.result->'adapter_sha256')<>'string' or new.result->>'adapter_sha256' !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(new.result->'observed_at')<>'string'
      or new.result->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
      then raise exception 'Invalid supervised workflow outcome'; end if;
    if (new.result->>'observed_at')::timestamptz>clock_timestamp()+interval '1 minute'
      or (new.result->>'observed_at')::timestamptz<new.leased_at-interval '1 minute'
      then raise exception 'Workflow observation outside lease'; end if;
    if new.payload->'manifest'->>'operation'='account_register' and new.result->>'outcome'='verified'
      then raise exception 'Registration submission requires human identity handoff'; end if;
  end if;
  return new;
end $$;
revoke all on function private_reporting.validate_workflow_result() from public,anon,authenticated;
create trigger supervised_workflow_result before update on public.reporting_automation_tasks
  for each row execute function private_reporting.validate_workflow_result();
create function public.reporting_supervised_workflow_version() returns integer
language sql stable security invoker set search_path='' as $$ select 1; $$;
revoke all on function public.reporting_supervised_workflow_version() from public,anon,authenticated;
grant execute on function public.reporting_supervised_workflow_version() to authenticated;
notify pgrst,'reload schema';
