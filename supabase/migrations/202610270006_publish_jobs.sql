-- Durable publish-job protocol. Approved (draft, revision) -> one durable job -> worker claim/complete
-- with strict results, exact publication capture and duplicate-URL safety. The bundled agent does not
-- claim publish jobs; queueing alone never launches a browser.
alter table public.reporting_publications drop constraint reporting_publications_source_check;
alter table public.reporting_publications add constraint reporting_publications_source_check check (source in ('manual_entry','sheet_import','worker_publish'));
alter table public.reporting_notifications drop constraint reporting_notifications_kind_check;
alter table public.reporting_notifications add constraint reporting_notifications_kind_check check (kind in ('check_result','check_batch','publish_result'));

create table public.reporting_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  binding_id uuid not null,
  draft_id uuid not null,
  draft_revision integer not null check (draft_revision > 0),
  session_id uuid not null,
  worker_id uuid not null,
  content_snapshot jsonb not null,
  target_snapshot jsonb not null,
  adapter_sha256 text,
  result_url text,
  result_published_at timestamptz,
  status text not null default 'pending' check (status in ('pending','leased','completed','cancelled')),
  lease_token uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  outcome text check (outcome in ('submitted','needs_reconciliation','login_required','verification_required','proxy_issue','network_error','profile_error','validation_error')),
  failure_notes text check (failure_notes is null or char_length(failure_notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, binding_id) references public.reporting_worker_profiles(organization_id, id),
  foreign key (organization_id, draft_id) references public.reporting_content_drafts(organization_id, id),
  foreign key (organization_id, session_id) references public.reporting_work_sessions(organization_id, id),
  foreign key (organization_id, worker_id) references public.reporting_workers(organization_id, id)
);
-- One durable job per approved revision, forever: re-publishing requires un-approving and approving a new revision.
create unique index reporting_one_publish_per_revision on public.reporting_publish_jobs(draft_id, draft_revision);
create index reporting_publish_worker_queue on public.reporting_publish_jobs(worker_id, status, created_at);
create index reporting_publish_org on public.reporting_publish_jobs(organization_id, created_at desc);
create index reporting_publish_binding_fk on public.reporting_publish_jobs(organization_id, binding_id);
create index reporting_publish_draft_fk on public.reporting_publish_jobs(organization_id, draft_id);
create index reporting_publish_session_fk on public.reporting_publish_jobs(organization_id, session_id);
create index reporting_publish_worker_fk on public.reporting_publish_jobs(organization_id, worker_id);
create index reporting_publish_creator_fk on public.reporting_publish_jobs(created_by);
alter table public.reporting_publish_jobs enable row level security;
create policy publish_job_staff_read on public.reporting_publish_jobs for select to authenticated using (private_reporting.is_staff(organization_id));
revoke all on public.reporting_publish_jobs from public, anon, authenticated;
grant select on public.reporting_publish_jobs to authenticated;

create function private_reporting.publish_outcome_info(outcome text, out tone text, out headline text)
language sql immutable set search_path = '' as $$
  select case outcome when 'submitted' then 'positive' else 'attention' end,
         case outcome
           when 'submitted' then 'Content submitted; exact link recorded'
           when 'needs_reconciliation' then 'Ambiguous submission: reconcile before any retry'
           when 'validation_error' then 'Content rejected by platform or adapter validation'
           when 'login_required' then 'Login needed: publish could not run'
           when 'verification_required' then 'Verification needed: publish stopped for a person'
           when 'proxy_issue' then 'Proxy issue: publish could not run'
           when 'network_error' then 'Network problem: publish could not finish'
           when 'profile_error' then 'Browser profile did not open'
         end;
$$;
revoke all on function private_reporting.publish_outcome_info(text) from public, anon, authenticated;

create function public.reporting_enqueue_publish(org uuid, draft uuid, expected_revision integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.reporting_content_drafts; tgt jsonb; b public.reporting_worker_profiles; sid uuid; jid uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if draft is null or expected_revision is null or expected_revision <= 0 then raise exception 'Invalid draft'; end if;
  perform pg_advisory_xact_lock(hashtextextended(draft::text, 734));
  select * into d from public.reporting_content_drafts where id=draft and organization_id=org for update;
  if d.id is null or d.revision <> expected_revision or d.status <> 'approved' then raise exception 'Only the current approved revision can be queued'; end if;
  if exists(select 1 from public.reporting_publish_jobs where draft_id=d.id and
    (status in ('pending','leased') or outcome in ('submitted','needs_reconciliation'))) then
    raise exception 'This draft already has outstanding, submitted or ambiguous work; do not repost'; end if;
  select target into tgt from public.reporting_content_revisions where draft_id=d.id and revision=d.revision and event='approved';
  select * into b from public.reporting_worker_profiles where id=d.binding_id and organization_id=org for share;
  if b.id is null or tgt is null
     or b.worker_id <> (tgt->>'worker_id')::uuid or b.profile_id <> (tgt->>'profile_id')::uuid
     or b.customer_id <> (tgt->>'customer_id')::uuid or b.account_label <> tgt->>'account_label'
    then raise exception 'Approved assignment changed; review the draft again'; end if;
  perform 1 from public.reporting_workers where id=b.worker_id and organization_id=org and enabled for share;
  if not found then raise exception 'Worker unavailable'; end if;
  select id into sid from public.reporting_work_sessions where organization_id=org and user_id=auth.uid()
    and status='active' and started_at > clock_timestamp()-interval '10 hours' for update;
  if sid is null then raise exception 'Start an active work session first'; end if;
  begin
    insert into public.reporting_publish_jobs(organization_id, binding_id, draft_id, draft_revision, session_id, worker_id, created_by,content_snapshot,target_snapshot)
      values(org, b.id, d.id, d.revision, sid, b.worker_id, auth.uid(),d.content,tgt) returning id into jid;
  exception when unique_violation then raise exception 'A publish job already exists for this approved revision'; end;
  return jid;
end $$;

create or replace function public.reporting_claim_check(credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers; j public.reporting_check_jobs; post_url text;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  -- One browser operation at a time per worker, across both job types.
  if exists(select 1 from public.reporting_check_jobs where worker_id=w.id and status='leased')
     or exists(select 1 from public.reporting_publish_jobs where worker_id=w.id and status='leased') then return null; end if;
  update public.reporting_check_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and exists(
    select 1 from public.reporting_work_sessions s where s.id=q.session_id and (s.status='closed' or s.started_at<=clock_timestamp()-interval '10 hours'));
  -- Automatic next-session planning is opt-in per binding and per work session.
  -- Unknown publication dates remain unknown, but their explicit links may be checked.
  insert into public.reporting_check_jobs(organization_id,worker_id,binding_id,publication_id,session_id,profile_id)
    select b.organization_id,b.worker_id,b.id,p.id,s.id,b.profile_id
    from public.reporting_worker_profiles b
    join public.reporting_work_sessions s on s.id=b.monitoring_session_id and s.organization_id=b.organization_id
    join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
    join public.reporting_publications p on p.organization_id=b.organization_id and p.customer_id=b.customer_id and p.account_label=b.account_label
    join public.reporting_customers c on c.id=b.customer_id and c.organization_id=b.organization_id
    where b.worker_id=w.id and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')
      and (p.last_checked_at is null or p.last_checked_at<clock_timestamp()-interval '24 hours')
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
  select url into post_url from public.reporting_publications where id=j.publication_id and organization_id=j.organization_id;
  return jsonb_build_object('job_id',j.id,'publication_id',j.publication_id,'profile_id',j.profile_id,'url',post_url,
    'lease_token',j.lease_token,'lease_expires_at',j.lease_expires_at);
end $$;

create function public.reporting_claim_publish(credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers; j public.reporting_publish_jobs;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  -- One browser operation at a time per worker, across both job types.
  if exists(select 1 from public.reporting_check_jobs where worker_id=w.id and status='leased')
     or exists(select 1 from public.reporting_publish_jobs where worker_id=w.id and status='leased') then return null; end if;
  update public.reporting_publish_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and exists(
    select 1 from public.reporting_work_sessions s where s.id=q.session_id and (s.status='closed' or s.started_at<=clock_timestamp()-interval '10 hours'));
  -- Approval withdrawal, edits or a changed binding invalidate pending work. Never
  -- substitute the current content or assignment for the immutable authorized copy.
  update public.reporting_publish_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and not exists(
    select 1 from public.reporting_content_drafts d join public.reporting_worker_profiles b on b.id=q.binding_id and b.organization_id=q.organization_id
    where d.id=q.draft_id and d.organization_id=q.organization_id and d.status='approved' and d.revision=q.draft_revision
      and d.content=q.content_snapshot and q.target_snapshot=jsonb_build_object('binding_id',b.id,'customer_id',b.customer_id,
        'worker_id',b.worker_id,'profile_id',b.profile_id,'account_label',b.account_label));
  select q.* into j from public.reporting_publish_jobs q
    join public.reporting_work_sessions s on s.id=q.session_id and s.organization_id=q.organization_id
    join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
    where q.worker_id=w.id and q.status='pending' and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')
    order by q.created_at,q.id for update of q skip locked limit 1;
  if j.id is null then return null; end if;
  update public.reporting_publish_jobs set status='leased',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '10 minutes'
    where id=j.id returning * into j;
  return j.content_snapshot || jsonb_build_object('job_id',j.id,'draft_id',j.draft_id,'draft_revision',j.draft_revision,
    'customer_id',j.target_snapshot->>'customer_id','profile_id',j.target_snapshot->>'profile_id','account_label',j.target_snapshot->>'account_label',
    'lease_token',j.lease_token,'lease_expires_at',j.lease_expires_at);
end $$;

create function public.reporting_complete_publish(credential text, job uuid, lease uuid, result jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers; j public.reporting_publish_jobs;
  code text; notes text; fingerprint text; post_url text; stamp timestamptz; info record; pub uuid; effective text;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  select * into j from public.reporting_publish_jobs where id=job and worker_id=w.id for update;
  if j.id is null or j.lease_token is distinct from lease then raise exception 'Invalid lease'; end if;
  if j.status='completed' then return false; end if;
  if j.status<>'leased' or j.lease_expires_at <= clock_timestamp() then raise exception 'Expired or inactive lease'; end if;
  if result is null or jsonb_typeof(result)<>'object' or not (result ?& array['outcome','reason','adapter_sha256','post_url','published_at'])
    or exists(select 1 from jsonb_object_keys(result) k where k not in ('outcome','reason','adapter_sha256','post_url','published_at')) then raise exception 'Invalid result'; end if;
  code := result->>'outcome'; notes := result->>'reason'; fingerprint := result->>'adapter_sha256';
  if jsonb_typeof(result->'outcome')<>'string' or jsonb_typeof(result->'reason')<>'string' or jsonb_typeof(result->'adapter_sha256')<>'string'
    or code not in ('submitted','needs_reconciliation','login_required','verification_required','proxy_issue','network_error','profile_error','validation_error')
    or notes is null or char_length(trim(notes)) not between 1 and 2000 or fingerprint !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(result->'post_url') not in ('string','null')
    or jsonb_typeof(result->'published_at') not in ('string','null') then raise exception 'Invalid result fields'; end if;
  post_url := result->>'post_url';
  if post_url is not null then post_url := replace(btrim(post_url),'https://www.nextdoor.com/','https://nextdoor.com/'); end if;
  if result->>'published_at' is not null then
    if result->>'published_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then raise exception 'Publication time requires an explicit timezone'; end if;
    begin stamp := (result->>'published_at')::timestamptz;
    exception when others then raise exception 'Invalid publication time'; end;
  end if;
  if code='submitted' then
    if post_url is null or post_url !~ '^https://(www[.])?nextdoor[.]com/(p|for_sale_and_free)/[A-Za-z0-9_-]+$' then raise exception 'Submission requires the exact canonical post URL'; end if;
    if stamp is null or not isfinite(stamp) or stamp < j.leased_at-interval '1 minute' or stamp > clock_timestamp()+interval '5 minutes' then raise exception 'Publication time outside the lease window'; end if;
  elsif post_url is not null or stamp is not null then raise exception 'URL and publication time are only valid for a submitted outcome'; end if;
  effective := code;
  if code='submitted' and ((j.content_snapshot->>'kind'='post' and post_url !~ '/p/')
    or (j.content_snapshot->>'kind'='listing' and post_url !~ '/for_sale_and_free/')) then raise exception 'URL type must match the approved content'; end if;
  if code='submitted' then
    insert into public.reporting_publications(organization_id,customer_id,title,url,account_label,published_at,source,visibility,recorded_session_id,created_by)
      values(j.organization_id,(j.target_snapshot->>'customer_id')::uuid,left(j.content_snapshot->>'title',200),post_url,j.target_snapshot->>'account_label',stamp,'worker_publish','not_checked',j.session_id,j.created_by)
      on conflict (organization_id,customer_id,url) do nothing returning id into pub;
    -- A URL already recorded must never be silently double-counted; reconcile instead.
    if pub is null then effective := 'needs_reconciliation'; notes := left(notes,1900) || ' | Exact URL already recorded for this customer; publication was not duplicated.';
      select id into pub from public.reporting_publications where organization_id=j.organization_id and customer_id=(j.target_snapshot->>'customer_id')::uuid and url=post_url; end if;
  end if;
  select * into info from private_reporting.publish_outcome_info(effective);
  insert into public.reporting_notifications(organization_id,publication_id,kind,tone,title,message)
    values(j.organization_id,pub,'publish_result',info.tone,left(info.headline,160),
      'Submission outcome recorded. This is not a visibility check. Staff can review operational details in Publishing operations.');
  update public.reporting_publish_jobs set status='completed',completed_at=clock_timestamp(),outcome=effective,failure_notes=notes,
    adapter_sha256=fingerprint,result_url=post_url,result_published_at=stamp where id=j.id;
  return true;
end $$;

create function public.reporting_cancel_pending_publish(org uuid, job uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  update public.reporting_publish_jobs set status='cancelled' where id=job and organization_id=org and status='pending';
  if not found then raise exception 'Only a pending job can be cancelled'; end if;
end $$;

create function public.reporting_reconcile_expired_publish(org uuid, job uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  -- An expired submit may have reached the platform. Retain the original lease
  -- and classify ambiguity instead of silently freeing the draft for another post.
  update public.reporting_publish_jobs set status='completed',outcome='needs_reconciliation',completed_at=clock_timestamp(),
    failure_notes='Operator acknowledged expired operation; actual submission remains unknown. No automatic retry.'
    where id=job and organization_id=org and status='leased' and lease_expires_at<clock_timestamp();
  if not found then raise exception 'Only an expired lease can be reconciled'; end if;
end $$;

create or replace function public.reporting_revoke_worker(org uuid, worker uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  update public.reporting_workers set enabled=false where id=worker and organization_id=org;
  delete from private_reporting.worker_credentials where worker_id=worker and exists(
    select 1 from public.reporting_workers where id=worker and organization_id=org);
  update public.reporting_check_jobs set status='cancelled' where worker_id=worker and organization_id=org and status='pending';
  update public.reporting_publish_jobs set status='cancelled' where worker_id=worker and organization_id=org and status='pending';
end $$;

create or replace function public.reporting_reassign_worker_profile(org uuid, binding uuid, replacement uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.reporting_worker_profiles;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  select * into b from public.reporting_worker_profiles where id=binding and organization_id=org for update;
  if b.id is null then raise exception 'Binding unavailable'; end if;
  if exists(select 1 from public.reporting_workers where id=b.worker_id and enabled) then raise exception 'Revoke the previous worker first'; end if;
  if exists(select 1 from public.reporting_check_jobs where profile_id=b.profile_id and status='leased')
    or exists(select 1 from public.reporting_publish_jobs where binding_id=b.id and status='leased') then raise exception 'Reconcile outstanding leases first'; end if;
  if not exists(select 1 from public.reporting_workers where id=replacement and organization_id=org and enabled) then raise exception 'Replacement worker unavailable'; end if;
  update public.reporting_check_jobs set status='cancelled' where binding_id=b.id and status='pending';
  update public.reporting_publish_jobs set status='cancelled' where binding_id=b.id and status='pending';
  update public.reporting_worker_profiles set worker_id=replacement,monitoring_session_id=null where id=b.id;
end $$;

revoke all on function public.reporting_enqueue_publish(uuid,uuid,integer), public.reporting_claim_publish(text), public.reporting_complete_publish(text,uuid,uuid,jsonb), public.reporting_cancel_pending_publish(uuid,uuid), public.reporting_reconcile_expired_publish(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reporting_enqueue_publish(uuid,uuid,integer), public.reporting_cancel_pending_publish(uuid,uuid), public.reporting_reconcile_expired_publish(uuid,uuid) to authenticated;
grant execute on function public.reporting_claim_publish(text), public.reporting_complete_publish(text,uuid,uuid,jsonb) to anon, authenticated;
comment on table public.reporting_publish_jobs is 'Durable one-per-approved-revision publish jobs. Queueing requires an approved revision, unchanged assignment and active staff session; completion is token-authenticated, lease-bound and replay-idempotent. Ambiguous submissions become needs_reconciliation and are never auto-retried.';
notify pgrst, 'reload schema';
