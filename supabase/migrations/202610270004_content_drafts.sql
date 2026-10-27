-- Preparation and human approval only. No publishing RPC or worker job is added.
create table public.reporting_content_drafts (
  id uuid primary key,
  organization_id uuid not null references public.reporting_organizations(id),
  binding_id uuid not null,
  content jsonb not null,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  revision integer not null default 1 check (revision > 0),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id,binding_id) references public.reporting_worker_profiles(organization_id,id),
  unique (organization_id,id),
  check ((status = 'approved') = (approved_at is not null))
);
create table public.reporting_content_revisions (
  organization_id uuid not null,
  draft_id uuid not null,
  revision integer not null,
  event text not null check (event in ('saved','approved','returned','archived')),
  content jsonb not null,
  target jsonb not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (draft_id,revision),
  foreign key (organization_id,draft_id) references public.reporting_content_drafts(organization_id,id)
);
create index reporting_content_org_recent on public.reporting_content_drafts(organization_id,updated_at desc,id);
create index reporting_content_binding_fk on public.reporting_content_drafts(organization_id,binding_id);
create index reporting_content_creator_fk on public.reporting_content_drafts(created_by);
create index reporting_content_approver_fk on public.reporting_content_drafts(approved_by);
create index reporting_content_history_fk on public.reporting_content_revisions(organization_id,draft_id);
create index reporting_content_actor_fk on public.reporting_content_revisions(actor_id);
alter table public.reporting_content_drafts enable row level security;
alter table public.reporting_content_revisions enable row level security;
create policy content_staff_read on public.reporting_content_drafts for select to authenticated using (private_reporting.is_staff(organization_id));
create policy content_history_staff_read on public.reporting_content_revisions for select to authenticated using (private_reporting.is_staff(organization_id));
revoke all on public.reporting_content_drafts,public.reporting_content_revisions from public,anon,authenticated;
grant select on public.reporting_content_drafts,public.reporting_content_revisions to authenticated;

create function private_reporting.valid_draft_content(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if value is null or jsonb_typeof(value)<>'object' then return false; end if;
  if not (value ?& array['kind','title','body','audience','price_cents','category'])
    or exists(select 1 from jsonb_object_keys(value) k where k not in ('kind','title','body','audience','price_cents','category')) then return false; end if;
  if jsonb_typeof(value->'kind')<>'string' or value->>'kind' not in ('post','listing')
    or jsonb_typeof(value->'title')<>'string' or char_length(trim(value->>'title')) not between 3 and 200
    or jsonb_typeof(value->'body')<>'string' or char_length(trim(value->>'body')) not between 1 and 5000
    or jsonb_typeof(value->'audience')<>'string' or value->>'audience' not in ('anyone','nearby','neighborhood') then return false; end if;
  if value->>'kind'='post' then
    return value->'price_cents'='null'::jsonb and value->'category'='null'::jsonb;
  end if;
  if jsonb_typeof(value->'price_cents')<>'number' or (value->>'price_cents')::numeric < 0
    or (value->>'price_cents')::numeric > 1000000000
    or trunc((value->>'price_cents')::numeric) <> (value->>'price_cents')::numeric
    or jsonb_typeof(value->'category')<>'string' or char_length(trim(value->>'category')) not between 1 and 120 then return false; end if;
  return true;
end $$;
revoke all on function private_reporting.valid_draft_content(jsonb) from public,anon,authenticated;
alter table public.reporting_content_drafts add constraint reporting_content_valid check (private_reporting.valid_draft_content(content));

create function public.reporting_save_content_draft(org uuid,draft uuid,expected_revision integer,binding uuid,value jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.reporting_content_drafts; b public.reporting_worker_profiles;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if draft is null or expected_revision is null or expected_revision<0 or not private_reporting.valid_draft_content(value) then raise exception 'Invalid draft'; end if;
  -- Same lock order as approval: draft then binding then worker. Lock new IDs too.
  perform pg_advisory_xact_lock(hashtextextended(draft::text,734));
  select * into d from public.reporting_content_drafts where id=draft and organization_id=org for update;
  if expected_revision=0 then
    if d.id is not null then raise exception 'Draft changed; refresh before saving'; end if;
  elsif d.id is null or d.revision<>expected_revision then raise exception 'Draft changed; refresh before saving';
  elsif d.status<>'draft' then raise exception 'Return approved content to draft before editing'; end if;
  select * into b from public.reporting_worker_profiles where id=binding and organization_id=org for share;
  if b.id is null then raise exception 'Authorized profile assignment required'; end if;
  perform 1 from public.reporting_workers where id=b.worker_id and organization_id=org and enabled for share;
  if not found then raise exception 'Worker unavailable'; end if;
  if expected_revision=0 then
    insert into public.reporting_content_drafts(id,organization_id,binding_id,content,created_by)
      values(draft,org,binding,value,auth.uid()) returning * into d;
  else
    update public.reporting_content_drafts set content=value,binding_id=binding,revision=revision+1,updated_at=clock_timestamp()
      where id=draft returning * into d;
  end if;
  insert into public.reporting_content_revisions(organization_id,draft_id,revision,event,content,target,actor_id)
    values(org,d.id,d.revision,'saved',d.content,jsonb_build_object('binding_id',b.id,'customer_id',b.customer_id,
      'worker_id',b.worker_id,'profile_id',b.profile_id,'account_label',b.account_label),auth.uid());
  return d.id;
end $$;

create function public.reporting_review_content_draft(org uuid,draft uuid,expected_revision integer,decision text,confirmed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.reporting_content_drafts; b public.reporting_worker_profiles; next_status text;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if confirmed is distinct from true or decision is null or decision not in ('approve','return','archive') then raise exception 'Explicit review confirmation required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(draft::text,734));
  select * into d from public.reporting_content_drafts where id=draft and organization_id=org for update;
  if d.id is null or expected_revision is null or d.revision<>expected_revision then raise exception 'Draft changed; refresh before reviewing'; end if;
  if d.status='archived' or (decision='approve' and d.status<>'draft') or (decision='return' and d.status<>'approved') then raise exception 'Invalid review transition'; end if;
  select * into b from public.reporting_worker_profiles where id=d.binding_id and organization_id=org for share;
  if decision='approve' then
    if not exists(select 1 from public.reporting_content_revisions r where r.draft_id=d.id and r.revision=d.revision
      and r.target=jsonb_build_object('binding_id',b.id,'customer_id',b.customer_id,'worker_id',b.worker_id,
        'profile_id',b.profile_id,'account_label',b.account_label)) then raise exception 'Assignment changed; save a new revision before approval'; end if;
    perform 1 from public.reporting_workers where id=b.worker_id and organization_id=org and enabled for share;
    if not found then raise exception 'Worker unavailable'; end if;
  end if;
  next_status:=case decision when 'approve' then 'approved' when 'return' then 'draft' else 'archived' end;
  update public.reporting_content_drafts set status=next_status,revision=revision+1,updated_at=clock_timestamp(),
    approved_by=case when decision='approve' then auth.uid() else null end,
    approved_at=case when decision='approve' then clock_timestamp() else null end
    where id=d.id returning * into d;
  insert into public.reporting_content_revisions(organization_id,draft_id,revision,event,content,target,actor_id)
    values(org,d.id,d.revision,case decision when 'approve' then 'approved' when 'return' then 'returned' else 'archived' end,
      d.content,jsonb_build_object('binding_id',b.id,'customer_id',b.customer_id,'worker_id',b.worker_id,
      'profile_id',b.profile_id,'account_label',b.account_label),auth.uid());
end $$;
revoke all on function public.reporting_save_content_draft(uuid,uuid,integer,uuid,jsonb),public.reporting_review_content_draft(uuid,uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.reporting_save_content_draft(uuid,uuid,integer,uuid,jsonb),public.reporting_review_content_draft(uuid,uuid,integer,text,boolean) to authenticated;
comment on table public.reporting_content_drafts is 'Staff-only preparation and revision-bound human approval. Not publications, schedules, browser jobs or permission for automatic submission.';
comment on table public.reporting_content_revisions is 'Append-only via narrow RPCs; content and exact target snapshots at each revision. Client writes denied. No credentials or media bytes.';
notify pgrst, 'reload schema';
