-- Standalone customer reporting only. No browser jobs, credentials or execution bridge.
-- The migration runner supplies the transaction boundary.
create schema if not exists private_reporting;
revoke all on schema private_reporting from public, anon, authenticated;
grant usage on schema private_reporting to authenticated;

create function public.reporting_valid_timezone(zone text) returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from pg_catalog.pg_timezone_names where name = zone);
$$;

create table public.reporting_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  time_zone text not null default 'America/Los_Angeles' check (public.reporting_valid_timezone(time_zone)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.reporting_memberships (
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'customer')),
  primary key (organization_id, user_id)
);

create table public.reporting_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  service text check (char_length(service) <= 160),
  time_zone text not null default 'America/Los_Angeles' check (public.reporting_valid_timezone(time_zone)),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.reporting_customer_access (
  organization_id uuid not null,
  user_id uuid not null,
  customer_id uuid not null,
  primary key (organization_id, user_id, customer_id),
  foreign key (organization_id, user_id) references public.reporting_memberships(organization_id, user_id) on delete cascade,
  foreign key (organization_id, customer_id) references public.reporting_customers(organization_id, id) on delete cascade
);

create table public.reporting_work_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('active', 'paused', 'closed')) default 'active',
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  ended_at timestamptz,
  paused_seconds integer not null default 0 check (paused_seconds >= 0),
  business_time_zone text not null check (public.reporting_valid_timezone(business_time_zone)),
  device_time_zone text not null check (public.reporting_valid_timezone(device_time_zone)),
  unique (organization_id, id),
  check ((status = 'closed') = (ended_at is not null)),
  check ((status = 'paused') = (paused_at is not null)),
  check (ended_at is null or ended_at >= started_at)
);

create unique index reporting_one_open_session on public.reporting_work_sessions(organization_id, user_id) where status <> 'closed';

create table public.reporting_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  customer_id uuid not null,
  title text not null check (char_length(title) between 3 and 200),
  url text not null check (char_length(url) <= 2000 and url ~ '^https://([a-z0-9-]+[.])*nextdoor[.](com|co[.]uk)/(p|for_sale_and_free)/[A-Za-z0-9_-]+$'),
  account_label text not null check (char_length(account_label) between 1 and 120),
  published_at timestamptz check (published_at <= now() + interval '5 minutes'),
  source text not null check (source in ('manual_entry', 'sheet_import')),
  visibility text not null default 'not_checked' check (visibility in ('not_checked', 'live', 'unavailable', 'confirmed_removed', 'deleted_by_owner', 'unknown')),
  last_observed_at timestamptz,
  comments_total integer check (comments_total >= 0),
  recorded_session_id uuid,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.reporting_customers(organization_id, id),
  foreign key (organization_id, recorded_session_id) references public.reporting_work_sessions(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, customer_id, url)
);

create table public.reporting_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  publication_id uuid not null,
  visibility text not null check (visibility in ('live', 'unavailable', 'confirmed_removed', 'deleted_by_owner', 'unknown')),
  observed_at timestamptz not null default now() check (observed_at <= now() + interval '5 minutes'),
  source text not null default 'manual_review' check (source = 'manual_review'),
  comments_total integer check (comments_total >= 0),
  comments_complete boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  foreign key (organization_id, publication_id) references public.reporting_publications(organization_id, id) on delete cascade
);

create table public.reporting_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  publication_id uuid not null,
  source_comment_id text check (char_length(source_comment_id) <= 200),
  author_label text not null check (char_length(author_label) between 1 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  platform_created_at timestamptz check (platform_created_at <= now() + interval '5 minutes'),
  first_observed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  foreign key (organization_id, publication_id) references public.reporting_publications(organization_id, id) on delete cascade
);

create unique index reporting_unique_external_comment on public.reporting_comments(organization_id, publication_id, source_comment_id) where source_comment_id is not null;
create index reporting_publication_day on public.reporting_publications(organization_id, published_at);
create index reporting_observation_history on public.reporting_observations(publication_id, observed_at desc);
create index reporting_comment_period on public.reporting_comments(organization_id, first_observed_at);
create index reporting_membership_user on public.reporting_memberships(user_id);
create index reporting_organization_creator on public.reporting_organizations(created_by);
create index reporting_session_user on public.reporting_work_sessions(user_id, started_at desc);
create index reporting_access_customer on public.reporting_customer_access(organization_id, customer_id);
create index reporting_publication_session on public.reporting_publications(organization_id, recorded_session_id);
create index reporting_publication_creator on public.reporting_publications(created_by);
create index reporting_publication_recent on public.reporting_publications(organization_id, created_at desc);
create index reporting_observation_publication on public.reporting_observations(organization_id, publication_id);
create index reporting_observation_creator on public.reporting_observations(created_by);
create index reporting_comment_publication on public.reporting_comments(organization_id, publication_id, first_observed_at desc);
create index reporting_comment_creator on public.reporting_comments(created_by);

create function private_reporting.is_staff(org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.reporting_memberships m where m.organization_id = org and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin', 'operator'));
$$;

create function private_reporting.is_member(org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.reporting_memberships m where m.organization_id = org and m.user_id = (select auth.uid()));
$$;

create function private_reporting.can_view_customer(org uuid, customer uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private_reporting.is_staff(org) or exists(
    select 1 from public.reporting_customer_access a join public.reporting_memberships m using (organization_id, user_id)
    where a.organization_id = org and a.customer_id = customer and a.user_id = (select auth.uid()) and m.role = 'customer'
  );
$$;

alter table public.reporting_organizations enable row level security;
alter table public.reporting_memberships enable row level security;
alter table public.reporting_customers enable row level security;
alter table public.reporting_customer_access enable row level security;
alter table public.reporting_work_sessions enable row level security;
alter table public.reporting_publications enable row level security;
alter table public.reporting_observations enable row level security;
alter table public.reporting_comments enable row level security;

create policy organization_read on public.reporting_organizations for select to authenticated using (private_reporting.is_member(id));
create policy membership_read_own on public.reporting_memberships for select to authenticated using (user_id = (select auth.uid()));
create policy access_read_own on public.reporting_customer_access for select to authenticated using (user_id = (select auth.uid()));
create policy customer_read on public.reporting_customers for select to authenticated using (private_reporting.can_view_customer(organization_id, id));
create policy customer_create on public.reporting_customers for insert to authenticated with check (private_reporting.is_staff(organization_id));
create policy customer_update on public.reporting_customers for update to authenticated using (private_reporting.is_staff(organization_id)) with check (private_reporting.is_staff(organization_id));
create policy session_read_own on public.reporting_work_sessions for select to authenticated using (user_id = (select auth.uid()) and private_reporting.is_staff(organization_id));
create policy publication_read on public.reporting_publications for select to authenticated using (private_reporting.can_view_customer(organization_id, customer_id));
-- Publication writes go through RPCs, so status summaries/session attribution cannot be spoofed through direct inserts.
create policy observation_read on public.reporting_observations for select to authenticated using (exists(
  select 1 from public.reporting_publications p where p.organization_id = reporting_observations.organization_id and p.id = reporting_observations.publication_id
));
create policy comment_read on public.reporting_comments for select to authenticated using (exists(
  select 1 from public.reporting_publications p where p.organization_id = reporting_comments.organization_id and p.id = reporting_comments.publication_id
));
create policy comment_create on public.reporting_comments for insert to authenticated with check (
  private_reporting.is_staff(organization_id) and created_by = (select auth.uid())
);

create function public.reporting_create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists(select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then raise exception 'Verify your email before creating a workspace'; end if;
  if char_length(trim(workspace_name)) not between 2 and 100 then raise exception 'Invalid workspace name'; end if;
  if exists(select 1 from public.reporting_memberships where user_id = auth.uid()) then raise exception 'A workspace is already assigned'; end if;
  -- Serialize concurrent requests from the same new user.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists(select 1 from public.reporting_memberships where user_id = auth.uid()) then raise exception 'A workspace is already assigned'; end if;
  insert into public.reporting_organizations(name, created_by) values (trim(workspace_name), auth.uid()) returning id into org;
  insert into public.reporting_memberships(organization_id, user_id, role) values (org, auth.uid(), 'owner');
  return org;
end;
$$;

create function public.reporting_session_action(org uuid, action text, device_zone text default 'UTC') returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.reporting_work_sessions; zone text; result_id uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = device_zone) then raise exception 'Invalid device timezone'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text || auth.uid()::text, 0));
  select * into s from public.reporting_work_sessions where organization_id = org and user_id = auth.uid() and status <> 'closed' for update;
  if action = 'start' then
    if s.id is not null then return s.id; end if;
    select time_zone into zone from public.reporting_organizations where id = org;
    insert into public.reporting_work_sessions(organization_id, user_id, business_time_zone, device_time_zone)
      values (org, auth.uid(), zone, device_zone) returning id into result_id;
    return result_id;
  end if;
  if s.id is null then raise exception 'No open session'; end if;
  if action = 'pause' and s.status = 'active' then
    update public.reporting_work_sessions set status = 'paused', paused_at = now() where id = s.id;
  elsif action = 'resume' and s.status = 'paused' then
    update public.reporting_work_sessions set status = 'active', paused_seconds = paused_seconds + floor(extract(epoch from now() - paused_at))::integer, paused_at = null where id = s.id;
  elsif action = 'end' then
    update public.reporting_work_sessions set status = 'closed', ended_at = now(),
      paused_seconds = paused_seconds + case when paused_at is null then 0 else floor(extract(epoch from now() - paused_at))::integer end, paused_at = null where id = s.id;
  else raise exception 'Invalid session transition'; end if;
  return s.id;
end;
$$;

create function public.reporting_add_publications(org uuid, customer uuid, records jsonb, record_source text default 'manual_entry') returns integer language plpgsql security definer set search_path = '' as $$
declare inserted integer; session_id uuid;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if not exists(select 1 from public.reporting_customers where organization_id = org and id = customer) then raise exception 'Customer not found'; end if;
  if record_source not in ('manual_entry', 'sheet_import') then raise exception 'Invalid source'; end if;
  if records is null or jsonb_typeof(records) <> 'array' or jsonb_array_length(records) not between 1 and 100 then raise exception 'Expected 1 to 100 records'; end if;
  if exists(select 1 from jsonb_array_elements(records) r where
    jsonb_typeof(r) <> 'object' or not (r ?& array['title', 'url', 'account_label']) or
    exists(select 1 from jsonb_object_keys(r) k where k not in ('title', 'url', 'account_label', 'published_at'))
  ) then raise exception 'Unexpected record fields'; end if;
  if exists(select 1 from jsonb_array_elements(records) r where nullif(r->>'published_at', '') is not null and
    r->>'published_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  ) then raise exception 'Publication times require an explicit UTC/offset suffix'; end if;
  select id into session_id from public.reporting_work_sessions where organization_id = org and user_id = auth.uid() and status = 'active';
  insert into public.reporting_publications(organization_id, customer_id, title, url, account_label, published_at, source, recorded_session_id, created_by)
  select org, customer, r->>'title', r->>'url', r->>'account_label', nullif(r->>'published_at', '')::timestamptz, record_source, session_id, auth.uid()
  from jsonb_array_elements(records) r
  on conflict (organization_id, customer_id, url) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create function public.reporting_record_observation(publication uuid, new_visibility text, total_comments integer default null, collection_complete boolean default false, review_notes text default '') returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.reporting_publications; observation_id uuid; observation_time timestamptz;
begin
  select * into p from public.reporting_publications where id = publication for update;
  if p.id is null or not private_reporting.is_staff(p.organization_id) then raise exception 'Not authorized'; end if;
  if new_visibility = 'confirmed_removed' and char_length(trim(review_notes)) < 10 then raise exception 'Explicit removal evidence is required'; end if;
  observation_time := clock_timestamp();
  insert into public.reporting_observations(organization_id, publication_id, visibility, observed_at, comments_total, comments_complete, notes, created_by)
    values (p.organization_id, p.id, new_visibility, observation_time, total_comments, collection_complete, review_notes, auth.uid()) returning id into observation_id;
  update public.reporting_publications set visibility = new_visibility, last_observed_at = observation_time, comments_total = total_comments where id = publication;
  return observation_id;
end;
$$;

revoke all on public.reporting_organizations, public.reporting_memberships, public.reporting_customer_access,
  public.reporting_customers, public.reporting_work_sessions, public.reporting_publications,
  public.reporting_observations, public.reporting_comments from public, anon, authenticated;
grant select on public.reporting_organizations, public.reporting_memberships, public.reporting_customer_access,
  public.reporting_customers, public.reporting_work_sessions, public.reporting_publications,
  public.reporting_observations, public.reporting_comments to authenticated;
grant insert (organization_id, name, service, time_zone), update (name, service, time_zone) on public.reporting_customers to authenticated;
grant insert (organization_id, publication_id, source_comment_id, author_label, body, platform_created_at, created_by) on public.reporting_comments to authenticated;

revoke execute on function private_reporting.is_staff(uuid), private_reporting.is_member(uuid), private_reporting.can_view_customer(uuid, uuid), public.reporting_valid_timezone(text),
  public.reporting_create_workspace(text), public.reporting_session_action(uuid, text, text),
  public.reporting_add_publications(uuid, uuid, jsonb, text), public.reporting_record_observation(uuid, text, integer, boolean, text) from public, anon;
grant execute on function private_reporting.is_staff(uuid), private_reporting.is_member(uuid), private_reporting.can_view_customer(uuid, uuid), public.reporting_valid_timezone(text),
  public.reporting_create_workspace(text), public.reporting_session_action(uuid, text, text),
  public.reporting_add_publications(uuid, uuid, jsonb, text), public.reporting_record_observation(uuid, text, integer, boolean, text) to authenticated;

comment on table public.reporting_work_sessions is 'Reporting work-session records only. Does not control browsers, jobs, accounts or the legacy automation.';
comment on table public.reporting_observations is 'Explicit manual observations. A stored live result is not a fresh automatic platform check.';

notify pgrst, 'reload schema';
