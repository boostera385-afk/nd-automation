-- Explicit opt-in result -> durable outbox mapping. No Google calls or default
-- mappings. Worker results and their write intents commit in one transaction.
create table public.reporting_sheet_publication_mappings (
  organization_id uuid not null,
  publication_id uuid not null,
  tab text not null check(tab in ('Auto Posting','Auto Listing')),
  row_id uuid not null,
  next_revision integer not null check(next_revision between 1 and 999999998),
  enabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,publication_id),
  unique(organization_id,tab,row_id),
  foreign key(organization_id,publication_id) references public.reporting_publications(organization_id,id) on delete cascade
);
create index reporting_sheet_mapping_owner on public.reporting_sheet_publication_mappings(created_by);
create table public.reporting_sheet_publish_targets (
  organization_id uuid not null,
  binding_id uuid not null,
  enabled boolean not null default false,
  include_checks boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,binding_id),
  foreign key(organization_id,binding_id) references public.reporting_worker_profiles(organization_id,id) on delete cascade
);
create index reporting_sheet_target_owner on public.reporting_sheet_publish_targets(created_by);
create table public.reporting_sheet_delivery_events (
  organization_id uuid not null,
  publication_id uuid not null,
  event_kind text not null check(event_kind in ('check','publish')),
  event_id uuid not null,
  outbox_id uuid,
  disposition text not null check(disposition in ('queued','skipped_authorization')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,event_kind,event_id),
  foreign key(organization_id,publication_id) references public.reporting_publications(organization_id,id) on delete cascade,
  foreign key(organization_id,outbox_id) references public.reporting_sheet_writeback_outbox(organization_id,id),
  check((disposition='queued')=(outbox_id is not null))
);
create index reporting_sheet_events_publication on public.reporting_sheet_delivery_events(organization_id,publication_id);
create index reporting_sheet_events_outbox on public.reporting_sheet_delivery_events(organization_id,outbox_id);

alter table public.reporting_sheet_publication_mappings enable row level security;
alter table public.reporting_sheet_publish_targets enable row level security;
alter table public.reporting_sheet_delivery_events enable row level security;
create policy sheet_mapping_staff_read on public.reporting_sheet_publication_mappings for select to authenticated using(private_reporting.sheet_writeback_access(organization_id));
create policy sheet_target_staff_read on public.reporting_sheet_publish_targets for select to authenticated using(private_reporting.sheet_writeback_access(organization_id));
create policy sheet_events_staff_read on public.reporting_sheet_delivery_events for select to authenticated using(private_reporting.sheet_writeback_access(organization_id));
revoke all on public.reporting_sheet_publication_mappings,public.reporting_sheet_publish_targets,public.reporting_sheet_delivery_events from public,anon,authenticated;
grant select on public.reporting_sheet_publication_mappings,public.reporting_sheet_publish_targets,public.reporting_sheet_delivery_events to authenticated;

create function private_reporting.sheet_mapping_owner_active(org uuid, actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.reporting_memberships m join auth.users u on u.id=m.user_id
    where m.organization_id=org and m.user_id=actor and m.role in ('owner','admin','operator') and u.email_confirmed_at is not null)
$$;
revoke all on function private_reporting.sheet_mapping_owner_active(uuid,uuid) from public,anon,authenticated;

create function public.reporting_set_publication_sheet_mapping(org uuid, publication uuid, tab_name text, stable_row uuid, expected_revision integer, enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare p public.reporting_publications;
begin
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if publication is null or stable_row is null or tab_name not in ('Auto Posting','Auto Listing') or expected_revision is null
    or expected_revision not between 1 and 999999997 or enabled is null then raise exception 'Invalid Sheet mapping'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||publication::text,20261104));
  select * into p from public.reporting_publications where id=publication and organization_id=org for update;
  if p.id is null then raise exception 'Publication unavailable'; end if;
  if (p.url ~ '/p/' and tab_name<>'Auto Posting') or (p.url ~ '/for_sale_and_free/' and tab_name<>'Auto Listing')
    or p.url !~ '^https://(www[.])?nextdoor[.]com/(p|for_sale_and_free)/[A-Za-z0-9_-]+$' then raise exception 'Mapping kind does not match the exact publication'; end if;
  -- Pause is always available. Retarget/rebase/re-enable cannot race queued work.
  if enabled and exists(select 1 from public.reporting_sheet_delivery_events e join public.reporting_sheet_writeback_outbox q
    on q.organization_id=e.organization_id and q.id=e.outbox_id where e.organization_id=org and e.publication_id=publication and q.status in ('pending','leased'))
    then raise exception 'Reconcile outstanding Sheet intents before changing an active mapping'; end if;
  insert into public.reporting_sheet_publication_mappings(organization_id,publication_id,tab,row_id,next_revision,enabled,created_by)
    values(org,publication,tab_name,stable_row,expected_revision,enabled,auth.uid())
    on conflict(organization_id,publication_id) do update set
      tab=case when excluded.enabled then excluded.tab else reporting_sheet_publication_mappings.tab end,
      row_id=case when excluded.enabled then excluded.row_id else reporting_sheet_publication_mappings.row_id end,
      next_revision=case when excluded.enabled then excluded.next_revision else reporting_sheet_publication_mappings.next_revision end,
      enabled=excluded.enabled,created_by=auth.uid(),updated_at=clock_timestamp();
end $$;

create function public.reporting_set_publish_sheet_target(org uuid, binding uuid, enabled boolean, include_checks boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if binding is null or enabled is null or include_checks is null then raise exception 'Invalid publishing Sheet target'; end if;
  perform 1 from public.reporting_worker_profiles where organization_id=org and id=binding for share;
  if not found then raise exception 'Assignment unavailable'; end if;
  insert into public.reporting_sheet_publish_targets(organization_id,binding_id,enabled,include_checks,created_by)
    values(org,binding,enabled,include_checks,auth.uid())
    on conflict(organization_id,binding_id) do update set enabled=excluded.enabled,include_checks=excluded.include_checks,
      created_by=auth.uid(),updated_at=clock_timestamp();
end $$;
revoke all on function public.reporting_set_publication_sheet_mapping(uuid,uuid,text,uuid,integer,boolean),
  public.reporting_set_publish_sheet_target(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.reporting_set_publication_sheet_mapping(uuid,uuid,text,uuid,integer,boolean),
  public.reporting_set_publish_sheet_target(uuid,uuid,boolean,boolean) to authenticated;

create function private_reporting.map_check_to_sheet() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.reporting_sheet_publication_mappings; p public.reporting_publications; oid uuid; intent jsonb;
begin
  select * into m from public.reporting_sheet_publication_mappings where organization_id=new.organization_id and publication_id=new.publication_id for update;
  if m.publication_id is null or not m.enabled then return new; end if;
  if not private_reporting.sheet_mapping_owner_active(m.organization_id,m.created_by) then
    insert into public.reporting_sheet_delivery_events(organization_id,publication_id,event_kind,event_id,disposition)
      values(new.organization_id,new.publication_id,'check',new.id,'skipped_authorization'); return new;
  end if;
  select * into p from public.reporting_publications where organization_id=new.organization_id and id=new.publication_id;
  -- Store exact check OUTCOME, including technical failure, not invented removal.
  intent := jsonb_build_object('action','update_cells','tab',m.tab,'rowRef','id:'||m.row_id::text,
    'values',jsonb_build_array(jsonb_build_object('Status',new.outcome,'Post link',p.url,'__expected_revision',m.next_revision::text)));
  insert into public.reporting_sheet_writeback_outbox(organization_id,request_id,stable_key,intent,created_by)
    values(new.organization_id,new.id,'auto-check:'||new.id::text,intent,m.created_by) returning id into oid;
  insert into public.reporting_sheet_delivery_events(organization_id,publication_id,event_kind,event_id,outbox_id,disposition)
    values(new.organization_id,new.publication_id,'check',new.id,oid,'queued');
  update public.reporting_sheet_publication_mappings set next_revision=next_revision+1,updated_at=clock_timestamp()
    where organization_id=m.organization_id and publication_id=m.publication_id;
  return new;
end $$;
revoke all on function private_reporting.map_check_to_sheet() from public,anon,authenticated;
create trigger reporting_check_sheet_outbox after insert on public.reporting_post_checks
  for each row execute function private_reporting.map_check_to_sheet();

create function private_reporting.map_publication_to_sheet() returns trigger
language plpgsql security definer set search_path='' as $$
declare target public.reporting_sheet_publish_targets; p public.reporting_publications; oid uuid; tab_name text; intent jsonb;
begin
  if old.status<>'leased' or new.status<>'completed' or new.outcome<>'submitted' then return new; end if;
  select * into target from public.reporting_sheet_publish_targets where organization_id=new.organization_id and binding_id=new.binding_id for share;
  if target.binding_id is null or not target.enabled then return new; end if;
  select * into p from public.reporting_publications where organization_id=new.organization_id
    and customer_id=(new.target_snapshot->>'customer_id')::uuid and url=new.result_url;
  if p.id is null or p.source<>'worker_publish' then raise exception 'Exact worker publication missing for Sheet mapping'; end if;
  if not private_reporting.sheet_mapping_owner_active(target.organization_id,target.created_by) then
    insert into public.reporting_sheet_delivery_events(organization_id,publication_id,event_kind,event_id,disposition)
      values(new.organization_id,p.id,'publish',new.id,'skipped_authorization'); return new;
  end if;
  tab_name := case new.content_snapshot->>'kind' when 'post' then 'Auto Posting' when 'listing' then 'Auto Listing' end;
  if tab_name is null then raise exception 'Unsupported Sheet publishing kind'; end if;
  intent := jsonb_build_object('action','append','tab',tab_name,'rowRef',null,'values',jsonb_build_array(
    jsonb_build_object('ND Row ID',p.id::text,'Profile Name',p.account_label,'Post link',p.url,'Status','not_checked')));
  insert into public.reporting_sheet_writeback_outbox(organization_id,request_id,stable_key,intent,created_by)
    values(new.organization_id,new.id,'auto-publish:'||new.id::text,intent,target.created_by) returning id into oid;
  insert into public.reporting_sheet_delivery_events(organization_id,publication_id,event_kind,event_id,outbox_id,disposition)
    values(new.organization_id,p.id,'publish',new.id,oid,'queued');
  insert into public.reporting_sheet_publication_mappings(organization_id,publication_id,tab,row_id,next_revision,enabled,created_by)
    values(new.organization_id,p.id,tab_name,p.id,1,target.include_checks,target.created_by);
  return new;
end $$;
revoke all on function private_reporting.map_publication_to_sheet() from public,anon,authenticated;
create trigger reporting_publish_sheet_outbox after update on public.reporting_publish_jobs
  for each row execute function private_reporting.map_publication_to_sheet();

create function public.reporting_sheet_mapping_version() returns integer
language sql stable security invoker set search_path='' as $$ select 1; $$;
revoke all on function public.reporting_sheet_mapping_version() from public,anon,authenticated;
grant execute on function public.reporting_sheet_mapping_version() to authenticated;

-- Respect dependency order (append -> revision 1 update -> revision 2 update)
-- across separately running deliverers. An in-flight batch blocks other claims;
-- replaying its original claim request remains idempotent, including after ack.
create or replace function private_reporting.claim_sheet_writeback(org uuid, batch_limit integer, request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.reporting_sheet_writeback_claims; item public.reporting_sheet_writeback_outbox;
  token uuid; claimed_items jsonb := '[]'::jsonb;
begin
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if request is null or batch_limit is null or batch_limit not between 1 and 50 then raise exception 'Invalid claim request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,20261030));
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select * into prior from public.reporting_sheet_writeback_claims where organization_id=org and request_id=request for update;
  if prior.request_id is not null then
    if prior.batch_limit<>batch_limit then raise exception 'Writeback claim replay conflict'; end if;
    return prior.claimed;
  end if;
  if exists(select 1 from public.reporting_sheet_writeback_outbox where organization_id=org and status='leased' and lease_expires_at>=clock_timestamp()) then
    insert into public.reporting_sheet_writeback_claims(organization_id,request_id,batch_limit,claimed) values(org,request,batch_limit,claimed_items);
    return claimed_items;
  end if;
  for item in select * from public.reporting_sheet_writeback_outbox where organization_id=org
    and (status='pending' or (status='leased' and lease_expires_at<clock_timestamp())) order by seq limit batch_limit for update
  loop
    if item.attempts>=5 then
      update public.reporting_sheet_writeback_outbox set status='failed',last_error='Attempts exhausted',lease_token=null,lease_expires_at=null where id=item.id;
      exit; -- Never skip exhausted work and dispatch a later dependency in this batch.
    end if;
    token := gen_random_uuid();
    update public.reporting_sheet_writeback_outbox set status='leased',attempts=attempts+1,lease_token=token,
      lease_expires_at=clock_timestamp()+interval '2 minutes' where id=item.id returning * into item;
    claimed_items := claimed_items || jsonb_build_object('id',item.id,'seq',item.seq,'intent',item.intent,'leaseToken',token,
      'expiresAt',item.lease_expires_at,'attempts',item.attempts);
  end loop;
  insert into public.reporting_sheet_writeback_claims(organization_id,request_id,batch_limit,claimed) values(org,request,batch_limit,claimed_items);
  return claimed_items;
end $$;
revoke all on function private_reporting.claim_sheet_writeback(uuid,integer,uuid) from public,anon;
grant execute on function private_reporting.claim_sheet_writeback(uuid,integer,uuid) to authenticated;
notify pgrst,'reload schema';
