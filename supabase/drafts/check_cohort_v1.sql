-- LOCAL REVIEW DRAFT ONLY. Not applied to hosted history; promote with the CLI
-- after separate deployment approval. Requires the existing monitoring bridge.
-- Additive: never replaces worker claim/complete or enables a profile/session.
create function private_reporting.cohort_staff(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.reporting_memberships m join auth.users u on u.id=m.user_id
    where m.organization_id=org and m.user_id=auth.uid() and u.email_confirmed_at is not null
      and m.role in ('owner','admin','operator'))
$$;
revoke all on function private_reporting.cohort_staff(uuid) from public,anon;
grant execute on function private_reporting.cohort_staff(uuid) to authenticated;

create table public.reporting_check_cohorts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.reporting_organizations(id),
  customer_id uuid not null,
  session_id uuid not null,
  requested_by uuid not null references auth.users(id),
  request_id uuid not null,
  cohort_day date not null check (isfinite(cohort_day)),
  time_zone text not null check (public.reporting_valid_timezone(time_zone)),
  publication_kind text not null check (publication_kind in ('posts','listings','both')),
  freshness_minutes integer not null check (freshness_minutes between 60 and 1440),
  policy_version integer not null default 1 check (policy_version=1),
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,customer_id) references public.reporting_customers(organization_id,id),
  foreign key (organization_id,session_id) references public.reporting_work_sessions(organization_id,id),
  unique(organization_id,request_id), unique(organization_id,id)
);
create index reporting_cohort_customer on public.reporting_check_cohorts(organization_id,customer_id,created_at desc);
create index reporting_cohort_session on public.reporting_check_cohorts(organization_id,session_id);
create index reporting_cohort_actor on public.reporting_check_cohorts(requested_by,created_at desc);
create index reporting_cohort_org_recent on public.reporting_check_cohorts(organization_id,created_at desc,id);
create index reporting_publication_cohort on public.reporting_publications(organization_id,customer_id,published_at,id);

create table public.reporting_check_cohort_items (
  organization_id uuid not null,
  cohort_id uuid not null,
  publication_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 500),
  url text not null check (char_length(url)<=2000),
  account_label text not null check (char_length(account_label) between 1 and 120),
  published_at timestamptz not null,
  disposition text not null check (disposition in ('queued','active_job','recent','unsupported_link','not_authorized','worker_unavailable')),
  job_id uuid references public.reporting_check_jobs(id),
  recent_checked_at timestamptz,
  recent_outcome text,
  primary key(cohort_id,publication_id), unique(cohort_id,ordinal),
  foreign key(organization_id,cohort_id) references public.reporting_check_cohorts(organization_id,id),
  foreign key(organization_id,publication_id) references public.reporting_publications(organization_id,id),
  check ((disposition in ('queued','active_job'))=(job_id is not null))
);
create index reporting_cohort_item_publication on public.reporting_check_cohort_items(organization_id,publication_id);
create index reporting_cohort_item_parent on public.reporting_check_cohort_items(organization_id,cohort_id);
create index reporting_cohort_item_job on public.reporting_check_cohort_items(job_id);
alter table public.reporting_check_cohorts enable row level security;
alter table public.reporting_check_cohort_items enable row level security;
create policy cohort_staff_read on public.reporting_check_cohorts for select to authenticated using(private_reporting.cohort_staff(organization_id));
create policy cohort_item_staff_read on public.reporting_check_cohort_items for select to authenticated using(private_reporting.cohort_staff(organization_id));
revoke all on public.reporting_check_cohorts,public.reporting_check_cohort_items from public,anon,authenticated;
grant select on public.reporting_check_cohorts,public.reporting_check_cohort_items to authenticated;

create function private_reporting.refresh_check_cohort(org uuid,customer uuid,day date,kind text,freshness integer,request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.reporting_check_cohorts; zone text; sid uuid; cid uuid := gen_random_uuid();
  start_at timestamptz; end_at timestamptz; unknown_dates integer; total integer; item record;
  candidates uuid[]; original_targets jsonb;
  b public.reporting_worker_profiles; wid uuid; jid uuid; disposition_ text;
  ordinal_ integer := 0; queued_ integer := 0; active_ integer := 0; recent_ integer := 0; blocked_ integer := 0;
  receipt_ jsonb; observed_now timestamptz;
begin
  if not private_reporting.cohort_staff(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if customer is null or day is null or not isfinite(day) or kind is null or kind not in ('posts','listings','both')
    or freshness is null or freshness not between 60 and 1440 or request is null then raise exception 'Invalid cohort request'; end if;
  -- Serializes double-clicks/new request IDs and rate/freshness decisions per org.
  perform pg_advisory_xact_lock(hashtextextended(org::text,20261030));
  if not private_reporting.cohort_staff(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select * into saved from public.reporting_check_cohorts h where h.organization_id=org and h.request_id=request;
  if saved.id is not null then
    if saved.requested_by is distinct from auth.uid() or saved.customer_id<>customer or saved.cohort_day<>day
      or saved.publication_kind<>kind or saved.freshness_minutes<>freshness then raise exception 'Cohort replay conflict'; end if;
    -- A lost response replays after pause/end without authorizing any new jobs.
    return saved.receipt;
  end if;
  if (select count(*) from public.reporting_check_cohorts h where h.organization_id=org
      and h.requested_by=auth.uid() and h.created_at>clock_timestamp()-interval '1 minute')>=6 then
    raise exception 'Cohort request rate limit';
  end if;
  select c.time_zone into zone from public.reporting_customers c where c.organization_id=org and c.id=customer;
  if zone is null then raise exception 'Customer unavailable'; end if;
  if day >= (clock_timestamp() at time zone zone)::date then raise exception 'Choose a prior business date'; end if;
  start_at := day::timestamp at time zone zone;
  end_at := (day+1)::timestamp at time zone zone;
  select s.id into sid from public.reporting_work_sessions s where s.organization_id=org and s.user_id=auth.uid()
    and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' for update;
  if sid is null then raise exception 'Start an active work session'; end if;
  -- Freeze a bounded ID/target set before waiting for worker locks. Imports or
  -- target edits during this request cannot silently change its membership.
  select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]),
    coalesce(jsonb_object_agg(p.id::text,jsonb_build_array(p.account_label,p.url,p.published_at)),'{}'::jsonb)
    into candidates,original_targets
    from (select p.id,p.account_label,p.url,p.published_at from public.reporting_publications p
      where p.organization_id=org and p.customer_id=customer and p.published_at>=start_at and p.published_at<end_at
        and (kind='both' or (kind='posts' and p.url like '%/p/%') or (kind='listings' and p.url like '%/for_sale_and_free/%'))
      order by p.id limit 501) p;
  total := cardinality(candidates);
  if total>500 then raise exception 'Cohort exceeds 500 tracked publications'; end if;
  -- Lock order: session -> workers -> bindings -> publications. A disable/revoke
  -- committing afterwards cancels the jobs just queued, rather than missing them.
  perform w.id from public.reporting_workers w where w.organization_id=org
    and exists(select 1 from public.reporting_worker_profiles x where x.worker_id=w.id and x.customer_id=customer and x.organization_id=org
      and exists(select 1 from public.reporting_publications p where p.id=any(candidates) and p.account_label=x.account_label))
    order by w.id for update;
  perform x.id from public.reporting_worker_profiles x where x.organization_id=org and x.customer_id=customer
    and exists(select 1 from public.reporting_publications p where p.id=any(candidates) and p.account_label=x.account_label)
    order by x.id for update;
  if not private_reporting.cohort_staff(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select count(*) into unknown_dates from public.reporting_publications p where p.organization_id=org and p.customer_id=customer
    and p.published_at is null and (kind='both' or (kind='posts' and p.url like '%/p/%') or (kind='listings' and p.url like '%/for_sale_and_free/%'));
  insert into public.reporting_check_cohorts(id,organization_id,customer_id,session_id,requested_by,request_id,cohort_day,time_zone,publication_kind,freshness_minutes,receipt)
    values(cid,org,customer,sid,auth.uid(),request,day,zone,kind,freshness,'{}');
  for item in select p.* from public.reporting_publications p where p.organization_id=org and p.customer_id=customer and p.id=any(candidates)
      order by p.id for update loop
    ordinal_ := ordinal_+1;
    if ordinal_>500 then raise exception 'Cohort exceeds 500 tracked publications'; end if;
    if original_targets->(item.id::text) is distinct from jsonb_build_array(item.account_label,item.url,item.published_at) then
      raise exception 'Cohort membership changed; reconcile before retry';
    end if;
    b := null; jid := null; wid := null; disposition_ := null;
    observed_now := clock_timestamp();
    -- Never substitute an unknown-date or other-day post for a missing member.
    if item.url !~ '^https://(www[.])?nextdoor[.]com/(p|for_sale_and_free)/[A-Za-z0-9_-]+$' then
      disposition_ := 'unsupported_link';
    else
      select * into b from public.reporting_worker_profiles x where x.organization_id=org and x.customer_id=customer and x.account_label=item.account_label;
      if b.id is null or b.monitoring_session_id is distinct from sid then disposition_ := 'not_authorized';
      else
        select w.id into wid from public.reporting_workers w where w.id=b.worker_id and w.organization_id=org and w.enabled;
        if wid is null then disposition_ := 'worker_unavailable';
        else
          select q.id into jid from public.reporting_check_jobs q where q.publication_id=item.id and q.organization_id=org and q.status in ('pending','leased');
          if jid is not null then disposition_ := 'active_job';
          elsif item.last_checked_at is not null and item.last_checked_at>observed_now-make_interval(mins=>freshness) then disposition_ := 'recent';
          else
            insert into public.reporting_check_jobs(organization_id,worker_id,binding_id,publication_id,session_id,profile_id)
              values(org,b.worker_id,b.id,item.id,sid,b.profile_id) on conflict do nothing returning id into jid;
            if jid is not null then disposition_ := 'queued';
            else
              select q.id into jid from public.reporting_check_jobs q where q.publication_id=item.id and q.organization_id=org and q.status in ('pending','leased');
              if jid is null then raise exception 'Cohort scheduling conflict; reconcile before retry'; end if;
              disposition_ := 'active_job';
            end if;
          end if;
        end if;
      end if;
    end if;
    if disposition_='queued' then queued_:=queued_+1;
    elsif disposition_='active_job' then active_:=active_+1;
    elsif disposition_='recent' then recent_:=recent_+1;
    else blocked_:=blocked_+1; end if;
    insert into public.reporting_check_cohort_items(organization_id,cohort_id,publication_id,ordinal,url,account_label,published_at,disposition,job_id,recent_checked_at,recent_outcome)
      values(org,cid,item.id,ordinal_,item.url,item.account_label,item.published_at,disposition_,jid,
        case when disposition_='recent' then item.last_checked_at end,case when disposition_='recent' then item.last_check_outcome end);
  end loop;
  if ordinal_<>total then raise exception 'Cohort membership changed; reconcile before retry'; end if;
  receipt_ := jsonb_build_object('version',1,'policyVersion',1,'organizationId',org,'cohortId',cid,'requestId',request,'customerId',customer,
    'day',day,'kind',kind,'timeZone',zone,'freshnessMinutes',freshness,'total',ordinal_,'unknownDates',unknown_dates,
    'queued',queued_,'active',active_,'recent',recent_,'blocked',blocked_);
  update public.reporting_check_cohorts h set receipt=receipt_ where h.id=cid;
  return receipt_;
end $$;
revoke all on function private_reporting.refresh_check_cohort(uuid,uuid,date,text,integer,uuid) from public,anon;
grant execute on function private_reporting.refresh_check_cohort(uuid,uuid,date,text,integer,uuid) to authenticated;

create function private_reporting.read_check_cohort(org uuid,cohort uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.reporting_check_cohorts; items_ jsonb;
begin
  if not private_reporting.cohort_staff(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select * into h from public.reporting_check_cohorts c where c.organization_id=org and c.id=cohort;
  if h.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('publicationId',i.publication_id,'ordinal',i.ordinal,'url',i.url,'accountLabel',i.account_label,
    'publishedAt',i.published_at,'disposition',i.disposition,'jobId',i.job_id,'status',q.status,'outcome',q.outcome,'completedAt',q.completed_at,
    'leaseExpiresAt',q.lease_expires_at,'recentCheckedAt',i.recent_checked_at,'recentOutcome',i.recent_outcome) order by i.ordinal),'[]') into items_
    from public.reporting_check_cohort_items i left join public.reporting_check_jobs q on q.id=i.job_id and q.organization_id=org
    where i.cohort_id=h.id and i.organization_id=org;
  return jsonb_build_object('receipt',h.receipt,'createdAt',h.created_at,'items',items_);
end $$;
revoke all on function private_reporting.read_check_cohort(uuid,uuid) from public,anon;
grant execute on function private_reporting.read_check_cohort(uuid,uuid) to authenticated;

create function public.reporting_refresh_check_cohort_v1(org uuid,customer uuid,day date,kind text,freshness_minutes integer,request_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private_reporting.refresh_check_cohort(org,customer,day,kind,freshness_minutes,request_id)
$$;
create function public.reporting_get_check_cohort_v1(org uuid,cohort_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private_reporting.read_check_cohort(org,cohort_id) $$;
revoke all on function public.reporting_refresh_check_cohort_v1(uuid,uuid,date,text,integer,uuid),public.reporting_get_check_cohort_v1(uuid,uuid) from public,anon;
grant execute on function public.reporting_refresh_check_cohort_v1(uuid,uuid,date,text,integer,uuid),public.reporting_get_check_cohort_v1(uuid,uuid) to authenticated;
