-- LOCAL CANDIDATE ONLY. Generate/review an imperative migration with the CLI
-- before application. Creates a private bucket; requires separate approval.
-- No scheduled deletion, worker access, signed URLs or publication-status writes.
create table public.reporting_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  publication_id uuid not null,
  customer_id uuid not null,
  object_key text not null unique,
  mime text not null check (mime in ('image/png','image/jpeg')),
  bytes integer not null check (bytes between 1 and 3145728),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null check (observed_at <= now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  review_after timestamptz, -- optional human-selected review date, NOT a deletion deadline
  held boolean not null default false,
  state text not null default 'pending' check (state in ('pending','ready','delete_requested','deleted')),
  deleted_at timestamptz,
  foreign key (organization_id,publication_id) references public.reporting_publications(organization_id,id),
  foreign key (organization_id,customer_id) references public.reporting_customers(organization_id,id),
  check (object_key = organization_id::text || '/' || id::text),
  check ((state='deleted') = (deleted_at is not null))
);
create index reporting_evidence_publication on public.reporting_evidence(organization_id,publication_id,created_at desc);
create index reporting_evidence_customer on public.reporting_evidence(organization_id,customer_id);
create index reporting_evidence_creator on public.reporting_evidence(created_by);
alter table public.reporting_evidence enable row level security;
revoke all on public.reporting_evidence from public,anon,authenticated;
grant select on public.reporting_evidence to authenticated;
create policy evidence_read on public.reporting_evidence for select to authenticated using (
  private_reporting.can_view_customer(organization_id,customer_id) and
  (state='ready' or private_reporting.is_staff(organization_id))
);

create function public.reporting_reserve_evidence(org uuid, publication uuid, content_mime text,
  content_bytes integer, content_sha256 text, observed timestamptz, review_days integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.reporting_publications; result_id uuid := gen_random_uuid();
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  select * into p from public.reporting_publications where organization_id=org and id=publication;
  if p.id is null then raise exception 'Publication not found'; end if;
  if observed is null or observed>clock_timestamp()+interval '5 minutes' or
    (review_days is not null and review_days not between 1 and 3650) then raise exception 'Invalid review date'; end if;
  -- Bound abandoned reservations and ordinary storage abuse per workspace.
  perform pg_advisory_xact_lock(hashtextextended('evidence:' || org::text,0));
  if (select count(*) from public.reporting_evidence where organization_id=org and state<>'deleted')>=10000
    then raise exception 'Evidence capacity reached; review retention'; end if;
  insert into public.reporting_evidence(id,organization_id,publication_id,customer_id,object_key,mime,bytes,sha256,observed_at,created_by,review_after)
    values(result_id,org,p.id,p.customer_id,org::text || '/' || result_id::text,content_mime,content_bytes,
      content_sha256,observed,auth.uid(),case when review_days is not null then now()+make_interval(days=>review_days) end);
  return result_id;
end $$;

-- Lock metadata for every transition. A hold cannot race an already-authorized
-- delete: delete_requested is irreversible, and new holds fail visibly then.
create function public.reporting_evidence_action(org uuid, evidence uuid, action text)
returns void language plpgsql security definer set search_path='' as $$
declare e public.reporting_evidence; stored jsonb;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  select * into e from public.reporting_evidence where organization_id=org and id=evidence for update;
  if e.id is null then raise exception 'Evidence not found'; end if;
  if action='ready' then
    if e.state='ready' then return; end if;
    if e.state<>'pending' or e.created_by<>auth.uid() then raise exception 'Upload state conflict'; end if;
    select metadata into stored from storage.objects where bucket_id='reporting-evidence' and name=e.object_key;
    if stored is null or stored->>'mimetype' is distinct from e.mime or
      stored->>'size' is distinct from e.bytes::text then raise exception 'Stored object does not match reservation'; end if;
    update public.reporting_evidence set state='ready' where id=e.id;
  elsif action in ('hold','release') then
    if e.state not in ('pending','ready') then raise exception 'Deletion already authorized; hold cannot be changed'; end if;
    -- Releasing preservation holds is an owner/admin decision, not any operator.
    if action='release' and not exists(select 1 from public.reporting_memberships where organization_id=org
      and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'Administrator required'; end if;
    update public.reporting_evidence set held=(action='hold') where id=e.id;
  elsif action='request_delete' then
    if e.held then raise exception 'Evidence is on hold'; end if;
    if e.state='deleted' then return; end if;
    update public.reporting_evidence set state='delete_requested' where id=e.id;
  elsif action='finish_delete' then
    if e.state='deleted' then return; end if;
    if e.state<>'delete_requested' or e.held then raise exception 'Deletion not authorized'; end if;
    if exists(select 1 from storage.objects where bucket_id='reporting-evidence' and name=e.object_key)
      then raise exception 'Remove the object through Storage first'; end if;
    update public.reporting_evidence set state='deleted',deleted_at=clock_timestamp() where id=e.id;
  else raise exception 'Unknown evidence action'; end if;
end $$;
revoke all on function public.reporting_reserve_evidence(uuid,uuid,text,integer,text,timestamptz,integer),
  public.reporting_evidence_action(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reporting_reserve_evidence(uuid,uuid,text,integer,text,timestamptz,integer),
  public.reporting_evidence_action(uuid,uuid,text) to authenticated;

-- INSERT only: immutable objects, no upsert or arbitrary object names.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values ('reporting-evidence','reporting-evidence',false,3145728,array['image/png','image/jpeg']);
create policy evidence_upload on storage.objects for insert to authenticated with check (
  bucket_id='reporting-evidence' and exists(select 1 from public.reporting_evidence e where
    e.object_key=name and e.state='pending' and e.created_by=(select auth.uid()) and
    private_reporting.is_staff(e.organization_id))
);
create policy evidence_download on storage.objects for select to authenticated using (
  bucket_id='reporting-evidence' and exists(select 1 from public.reporting_evidence e where
    e.object_key=name and private_reporting.can_view_customer(e.organization_id,e.customer_id) and
    (e.state='ready' or private_reporting.is_staff(e.organization_id)))
);
create policy evidence_delete on storage.objects for delete to authenticated using (
  bucket_id='reporting-evidence' and exists(select 1 from public.reporting_evidence e where
    e.object_key=name and e.state='delete_requested' and not e.held and private_reporting.is_staff(e.organization_id))
);
notify pgrst,'reload schema';
