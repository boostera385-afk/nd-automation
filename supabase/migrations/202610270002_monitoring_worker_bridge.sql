-- Read-only monitoring jobs only. Review and apply to staging separately.
-- Tokens are 256-bit random bearer credentials, stored only as SHA-256 hashes.
create table public.reporting_workers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  enabled boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create table private_reporting.worker_credentials (
  worker_id uuid primary key references public.reporting_workers(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$')
);
alter table private_reporting.worker_credentials enable row level security;
revoke all on private_reporting.worker_credentials from public, anon, authenticated;

create table public.reporting_worker_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  worker_id uuid not null,
  customer_id uuid not null,
  profile_id uuid not null unique,
  account_label text not null check (char_length(account_label) between 1 and 120),
  monitoring_session_id uuid,
  foreign key (organization_id, worker_id) references public.reporting_workers(organization_id, id),
  foreign key (organization_id, customer_id) references public.reporting_customers(organization_id, id),
  foreign key (organization_id, monitoring_session_id) references public.reporting_work_sessions(organization_id, id),
  unique (organization_id, customer_id, account_label),
  unique (organization_id, id)
);

create table public.reporting_check_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  worker_id uuid not null,
  binding_id uuid not null,
  publication_id uuid not null,
  session_id uuid not null,
  profile_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'leased', 'completed', 'cancelled')),
  lease_token uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  outcome text,
  adapter_sha256 text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, worker_id) references public.reporting_workers(organization_id, id),
  foreign key (organization_id, binding_id) references public.reporting_worker_profiles(organization_id, id),
  foreign key (organization_id, publication_id) references public.reporting_publications(organization_id, id),
  foreign key (organization_id, session_id) references public.reporting_work_sessions(organization_id, id)
);
create unique index reporting_one_open_check on public.reporting_check_jobs(publication_id) where status in ('pending', 'leased');
create unique index reporting_one_leased_profile on public.reporting_check_jobs(profile_id) where status = 'leased';
create index reporting_job_worker_queue on public.reporting_check_jobs(worker_id, status, created_at);
create index reporting_job_org on public.reporting_check_jobs(organization_id, created_at desc);

alter table public.reporting_workers enable row level security;
alter table public.reporting_worker_profiles enable row level security;
alter table public.reporting_check_jobs enable row level security;
create policy worker_staff_read on public.reporting_workers for select to authenticated using (private_reporting.is_staff(organization_id));
create policy worker_profile_staff_read on public.reporting_worker_profiles for select to authenticated using (private_reporting.is_staff(organization_id));
create policy check_job_staff_read on public.reporting_check_jobs for select to authenticated using (private_reporting.is_staff(organization_id));
revoke all on public.reporting_workers, public.reporting_worker_profiles, public.reporting_check_jobs from public, anon, authenticated;
grant select on public.reporting_workers, public.reporting_worker_profiles, public.reporting_check_jobs to authenticated;

create function public.reporting_register_worker(org uuid, worker_name text, credential_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare wid uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if credential_hash is null or credential_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential'; end if;
  insert into public.reporting_workers(organization_id, name) values (org, trim(worker_name)) returning id into wid;
  insert into private_reporting.worker_credentials values (wid, credential_hash);
  return wid;
end $$;

create function public.reporting_bind_worker_profile(org uuid, worker uuid, customer uuid, profile uuid, label text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare bid uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if not exists(select 1 from public.reporting_workers where id=worker and organization_id=org and enabled) then raise exception 'Worker unavailable'; end if;
  insert into public.reporting_worker_profiles(organization_id,worker_id,customer_id,profile_id,account_label)
    values(org,worker,customer,profile,trim(label)) returning id into bid;
  return bid;
end $$;

create function public.reporting_revoke_worker(org uuid, worker uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  update public.reporting_workers set enabled=false where id=worker and organization_id=org;
  delete from private_reporting.worker_credentials where worker_id=worker and exists(
    select 1 from public.reporting_workers where id=worker and organization_id=org);
  update public.reporting_check_jobs set status='cancelled' where worker_id=worker and organization_id=org and status='pending';
end $$;

create function public.reporting_set_profile_monitoring(org uuid, binding uuid, enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if enabled is null then raise exception 'Choose enabled or disabled'; end if;
  if enabled then
    if not exists(select 1 from public.reporting_worker_profiles b join public.reporting_workers w on w.id=b.worker_id where b.id=binding and b.organization_id=org and w.enabled) then raise exception 'Worker unavailable'; end if;
    select id into sid from public.reporting_work_sessions where organization_id=org and user_id=auth.uid()
      and status='active' and started_at > clock_timestamp()-interval '10 hours';
    if sid is null then raise exception 'Start an active work session first'; end if;
  end if;
  update public.reporting_worker_profiles set monitoring_session_id=sid where id=binding and organization_id=org;
  if not found then raise exception 'Binding unavailable'; end if;
  if not enabled then
    update public.reporting_check_jobs set status='cancelled' where binding_id=binding and organization_id=org and status='pending';
  end if;
end $$;

create function public.reporting_reassign_worker_profile(org uuid, binding uuid, replacement uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.reporting_worker_profiles;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  select * into b from public.reporting_worker_profiles where id=binding and organization_id=org for update;
  if b.id is null then raise exception 'Binding unavailable'; end if;
  if exists(select 1 from public.reporting_workers where id=b.worker_id and enabled) then raise exception 'Revoke the previous worker first'; end if;
  if exists(select 1 from public.reporting_check_jobs where profile_id=b.profile_id and status='leased') then raise exception 'Reconcile outstanding leases first'; end if;
  if not exists(select 1 from public.reporting_workers where id=replacement and organization_id=org and enabled) then raise exception 'Replacement worker unavailable'; end if;
  update public.reporting_check_jobs set status='cancelled' where binding_id=b.id and status='pending';
  update public.reporting_worker_profiles set worker_id=replacement,monitoring_session_id=null where id=b.id;
end $$;

create function private_reporting.worker_for_token(credential text) returns public.reporting_workers
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers;
begin
  if credential is null or credential !~ '^[a-f0-9]{64}$' then raise exception 'Invalid worker credential'; end if;
  select x.* into w from public.reporting_workers x join private_reporting.worker_credentials c on c.worker_id=x.id
    where c.token_hash=encode(sha256(convert_to(credential,'UTF8')),'hex') and x.enabled;
  if w.id is null then raise exception 'Invalid worker credential'; end if;
  return w;
end $$;
revoke all on function private_reporting.worker_for_token(text) from public, anon, authenticated;

create function public.reporting_worker_heartbeat(credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  return jsonb_build_object('worker_id',w.id,'enabled',true);
end $$;

create function public.reporting_enqueue_checks(org uuid, binding uuid, publications uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare b public.reporting_worker_profiles; sid uuid; inserted integer;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if publications is null or cardinality(publications) not between 1 and 100 or array_position(publications,null) is not null
    then raise exception 'Expected 1 to 100 publications'; end if;
  select * into b from public.reporting_worker_profiles where id=binding and organization_id=org;
  if b.id is null or not exists(select 1 from public.reporting_workers where id=b.worker_id and enabled) then raise exception 'Binding unavailable'; end if;
  select id into sid from public.reporting_work_sessions where organization_id=org and user_id=auth.uid() and status='active' and started_at>clock_timestamp()-interval '10 hours' for update;
  if sid is null then raise exception 'Start an active work session first'; end if;
  if exists(select 1 from unnest(publications) pid where not exists(
    select 1 from public.reporting_publications p where p.id=pid and p.organization_id=org and p.customer_id=b.customer_id and p.account_label=b.account_label
      and p.url ~ '^https://(www[.])?nextdoor[.]com/(p|for_sale_and_free)/[A-Za-z0-9_-]+$')) then raise exception 'Publication does not match the authorized profile binding'; end if;
  insert into public.reporting_check_jobs(organization_id,worker_id,binding_id,publication_id,session_id,profile_id)
    select org,b.worker_id,b.id,p.id,sid,b.profile_id from public.reporting_publications p where p.id=any(publications)
    on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

create function public.reporting_claim_check(credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers; j public.reporting_check_jobs; post_url text;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  -- Never re-run an expired lease: the original browser operation may still exist.
  if exists(select 1 from public.reporting_check_jobs where worker_id=w.id and status='leased') then return null; end if;
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

create function public.reporting_reconcile_expired_check(org uuid, job uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  update public.reporting_check_jobs set status='cancelled',lease_token=null
    where id=job and organization_id=org and status='leased' and lease_expires_at<clock_timestamp();
  if not found then raise exception 'Only an expired lease can be reconciled'; end if;
end $$;

create function public.reporting_cancel_pending_check(org uuid, job uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  update public.reporting_check_jobs set status='cancelled' where id=job and organization_id=org and status='pending';
  if not found then raise exception 'Only a pending job can be cancelled'; end if;
end $$;

alter table public.reporting_observations drop constraint reporting_observations_source_check;
alter table public.reporting_observations add constraint reporting_observations_source_check check (source in ('manual_review','auto_check'));
alter table public.reporting_comments add column source text not null default 'manual_review' check (source in ('manual_review','auto_check'));
alter policy comment_create on public.reporting_comments with check (
  private_reporting.is_staff(organization_id) and created_by = (select auth.uid()) and source='manual_review'
);

create function public.reporting_complete_check(credential text, job uuid, lease uuid, result jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare w public.reporting_workers; j public.reporting_check_jobs; code text; notes text; fingerprint text;
  info record; obs uuid; checked timestamptz; item jsonb;
begin
  w := private_reporting.worker_for_token(credential);
  -- Serializes revocation against a result transaction without granting the worker table writes.
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  select * into j from public.reporting_check_jobs where id=job and worker_id=w.id for update;
  if j.id is null or j.lease_token is distinct from lease then raise exception 'Invalid lease'; end if;
  if j.status='completed' then return false; end if;
  if j.status<>'leased' or j.lease_expires_at <= clock_timestamp() then raise exception 'Expired or inactive lease'; end if;
  if result is null or jsonb_typeof(result)<>'object' or not (result ?& array['outcome','reason','adapter_sha256','comments','observed_at'])
    or exists(select 1 from jsonb_object_keys(result) k where k not in ('outcome','reason','adapter_sha256','comments','observed_at')) then raise exception 'Invalid result'; end if;
  code:=result->>'outcome'; notes:=result->>'reason'; fingerprint:=result->>'adapter_sha256';
  -- Automatic removal confirmation is deliberately disabled pending validated evidence rules.
  if jsonb_typeof(result->'outcome')<>'string' or jsonb_typeof(result->'reason')<>'string' or jsonb_typeof(result->'adapter_sha256')<>'string'
    or code is null or code not in ('alive','unavailable','proxy_issue','login_required','verification_required','network_error','profile_error','needs_review')
    or notes is null or char_length(trim(notes)) not between 1 and 2000 or fingerprint is null or fingerprint !~ '^[a-f0-9]{64}$'
    then raise exception 'Invalid result fields'; end if;
  if jsonb_typeof(result->'comments')<>'array' or jsonb_array_length(result->'comments')>200 then raise exception 'Invalid comments'; end if;
  if code<>'alive' and jsonb_array_length(result->'comments')>0 then raise exception 'Comments require an exact visible post'; end if;
  for item in select value from jsonb_array_elements(result->'comments') loop
    if jsonb_typeof(item)<>'object' or not (item ?& array['external_id','body'])
      or exists(select 1 from jsonb_object_keys(item) k where k not in ('external_id','body'))
      or jsonb_typeof(item->'external_id')<>'string' or jsonb_typeof(item->'body')<>'string'
      or char_length(trim(item->>'external_id')) not between 1 and 200 or char_length(trim(item->>'body')) not between 1 and 5000
      then raise exception 'Invalid comment'; end if;
  end loop;
  if jsonb_typeof(result->'observed_at')<>'string' then raise exception 'Invalid observation time'; end if;
  checked := (result->>'observed_at')::timestamptz;
  if checked is null or not isfinite(checked) or checked<j.leased_at-interval '1 minute' or checked>clock_timestamp()+interval '5 minutes' then raise exception 'Observation time outside the lease window'; end if;
  perform 1 from public.reporting_publications where id=j.publication_id and organization_id=j.organization_id for update;
  select * into info from private_reporting.check_outcome_info(code);
  if info.new_visibility is not null then
    insert into public.reporting_observations(organization_id,publication_id,visibility,observed_at,source,comments_complete,notes,created_by)
      values(j.organization_id,j.publication_id,info.new_visibility,checked,'auto_check',false,notes,null) returning id into obs;
    update public.reporting_publications set visibility=info.new_visibility,last_observed_at=checked where id=j.publication_id and (last_observed_at is null or last_observed_at<=checked);
  end if;
  update public.reporting_publications set last_check_outcome=code,last_checked_at=checked where id=j.publication_id and (last_checked_at is null or last_checked_at<=checked);
  insert into public.reporting_post_checks(organization_id,publication_id,outcome,tone,message,notes,source,checked_at,observation_id,created_by)
    values(j.organization_id,j.publication_id,code,info.tone,info.headline,notes,'auto_check',checked,obs,null);
  for item in select value from jsonb_array_elements(result->'comments') loop
    insert into public.reporting_comments(organization_id,publication_id,source_comment_id,author_label,body,created_by,source,first_observed_at)
      values(j.organization_id,j.publication_id,item->>'external_id','Author not collected',item->>'body',null,'auto_check',checked)
      on conflict do nothing;
  end loop;
  insert into public.reporting_notifications(organization_id,publication_id,kind,tone,title,message)
    values(j.organization_id,j.publication_id,'check_result',info.tone,info.headline,'Automatic read-only check completed; comment collection is partial.');
  update public.reporting_check_jobs set status='completed',completed_at=clock_timestamp(),outcome=code,adapter_sha256=fingerprint where id=j.id;
  return true;
end $$;

revoke all on function public.reporting_register_worker(uuid,text,text),public.reporting_bind_worker_profile(uuid,uuid,uuid,uuid,text),
  public.reporting_set_profile_monitoring(uuid,uuid,boolean),
  public.reporting_reconcile_expired_check(uuid,uuid),
  public.reporting_reassign_worker_profile(uuid,uuid,uuid),
  public.reporting_revoke_worker(uuid,uuid),public.reporting_enqueue_checks(uuid,uuid,uuid[]),public.reporting_cancel_pending_check(uuid,uuid),
  public.reporting_worker_heartbeat(text),public.reporting_claim_check(text),public.reporting_complete_check(text,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.reporting_register_worker(uuid,text,text),public.reporting_bind_worker_profile(uuid,uuid,uuid,uuid,text),
  public.reporting_set_profile_monitoring(uuid,uuid,boolean),
  public.reporting_reconcile_expired_check(uuid,uuid),
  public.reporting_reassign_worker_profile(uuid,uuid,uuid),
  public.reporting_revoke_worker(uuid,uuid),public.reporting_enqueue_checks(uuid,uuid,uuid[]),public.reporting_cancel_pending_check(uuid,uuid) to authenticated;
-- Public API transport, authenticated by a scoped revocable 256-bit worker credential inside each RPC.
grant execute on function public.reporting_worker_heartbeat(text),public.reporting_claim_check(text),public.reporting_complete_check(text,uuid,uuid,jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
