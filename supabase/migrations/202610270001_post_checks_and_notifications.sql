-- Post check results (Alive / Removed from Nextdoor / Proxy issue / ...) and in-app notifications.
-- Additive only: no existing table is dropped or rewritten. The migration runner supplies the transaction boundary.
-- A check that could not be completed (proxy, login, verification, network, profile) never changes a post's
-- visibility, so a connection problem can never be mistaken for a removal.

alter table public.reporting_publications
  add column last_check_outcome text check (last_check_outcome in ('alive', 'deleted_from_nd', 'unavailable', 'proxy_issue', 'login_required', 'verification_required', 'network_error', 'profile_error', 'needs_review')),
  add column last_checked_at timestamptz;

create table public.reporting_post_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  publication_id uuid not null,
  outcome text not null check (outcome in ('alive', 'deleted_from_nd', 'unavailable', 'proxy_issue', 'login_required', 'verification_required', 'network_error', 'profile_error', 'needs_review')),
  tone text not null check (tone in ('positive', 'negative', 'attention')),
  message text not null check (char_length(message) between 1 and 300),
  notes text not null default '' check (char_length(notes) <= 2000),
  source text not null default 'manual_review' check (source in ('manual_review', 'auto_check')),
  checked_at timestamptz not null default now() check (checked_at <= now() + interval '5 minutes'),
  comments_total integer check (comments_total >= 0),
  observation_id uuid references public.reporting_observations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  foreign key (organization_id, publication_id) references public.reporting_publications(organization_id, id) on delete cascade
);

create table public.reporting_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  publication_id uuid,
  kind text not null check (kind in ('check_result', 'check_batch')),
  tone text not null check (tone in ('positive', 'negative', 'attention')),
  title text not null check (char_length(title) between 1 and 160),
  message text not null check (char_length(message) <= 400),
  check_count integer not null default 1 check (check_count >= 1),
  created_at timestamptz not null default now(),
  foreign key (organization_id, publication_id) references public.reporting_publications(organization_id, id) on delete cascade
);

create table public.reporting_notification_state (
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index reporting_check_publication on public.reporting_post_checks(organization_id, publication_id, checked_at desc);
create index reporting_check_recent on public.reporting_post_checks(organization_id, checked_at desc);
create index reporting_check_observation on public.reporting_post_checks(observation_id);
create index reporting_check_creator on public.reporting_post_checks(created_by);
create index reporting_notification_recent on public.reporting_notifications(organization_id, created_at desc);
create index reporting_notification_publication on public.reporting_notifications(organization_id, publication_id);
create index reporting_notification_state_user on public.reporting_notification_state(user_id);

-- Single source of truth for what each outcome means. The web app mirrors this table and a test keeps them equal.
create function private_reporting.check_outcome_info(outcome text, out tone text, out headline text, out new_visibility text)
language sql immutable set search_path = '' as $$
  select
    case outcome
      when 'alive' then 'positive'
      when 'deleted_from_nd' then 'negative' when 'unavailable' then 'negative'
      when 'proxy_issue' then 'attention' when 'login_required' then 'attention' when 'verification_required' then 'attention'
      when 'network_error' then 'attention' when 'profile_error' then 'attention' when 'needs_review' then 'attention'
    end,
    case outcome
      when 'alive' then 'Post is alive'
      when 'deleted_from_nd' then 'Post was removed from Nextdoor'
      when 'unavailable' then 'Post is not accessible'
      when 'proxy_issue' then 'Proxy issue: post could not be checked'
      when 'login_required' then 'Login needed: post could not be checked'
      when 'verification_required' then 'Verification needed: post could not be checked'
      when 'network_error' then 'Network problem: post could not be checked'
      when 'profile_error' then 'Browser profile did not open: post could not be checked'
      when 'needs_review' then 'Needs a closer look'
    end,
    case outcome
      when 'alive' then 'live' when 'deleted_from_nd' then 'confirmed_removed' when 'unavailable' then 'unavailable'
    end
$$;

alter table public.reporting_post_checks enable row level security;
alter table public.reporting_notifications enable row level security;
alter table public.reporting_notification_state enable row level security;

create policy post_check_read on public.reporting_post_checks for select to authenticated using (exists(
  select 1 from public.reporting_publications p where p.organization_id = reporting_post_checks.organization_id and p.id = reporting_post_checks.publication_id
));
create policy notification_read on public.reporting_notifications for select to authenticated using (
  private_reporting.is_staff(organization_id) or (publication_id is not null and exists(
    select 1 from public.reporting_publications p where p.organization_id = reporting_notifications.organization_id and p.id = reporting_notifications.publication_id
  ))
);
create policy notification_state_read on public.reporting_notification_state for select to authenticated using (user_id = (select auth.uid()));

-- One atomic call for one post or a whole batch (up to 100). Writes the check, the visibility summary,
-- the observation history and the notification together, or nothing at all.
create function public.reporting_record_checks(org uuid, checks jsonb, review_notes text default '') returns integer language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; p public.reporting_publications; pid uuid; code text; comments integer; notes text := coalesce(review_notes, '');
  v_tone text; v_headline text; v_visibility text; checked timestamptz; obs uuid;
  recorded integer := 0; positive_count integer := 0; negative_count integer := 0; attention_count integer := 0;
  seen uuid[] := '{}'; last_pub uuid; last_title text; last_label text; last_headline text; last_tone text;
begin
  if not private_reporting.is_staff(org) then raise exception 'Not authorized'; end if;
  if checks is null or jsonb_typeof(checks) <> 'array' or jsonb_array_length(checks) not between 1 and 100 then raise exception 'Expected 1 to 100 checks'; end if;
  if char_length(notes) > 2000 then raise exception 'Notes are too long'; end if;
  if exists(select 1 from jsonb_array_elements(checks) c where
    jsonb_typeof(c) <> 'object' or not (c ?& array['publication_id', 'outcome']) or
    exists(select 1 from jsonb_object_keys(c) k where k not in ('publication_id', 'outcome', 'comments_total'))
  ) then raise exception 'Unexpected check fields'; end if;

  for item in select value from jsonb_array_elements(checks) loop
    pid := (item->>'publication_id')::uuid;
    code := item->>'outcome';
    comments := nullif(item->>'comments_total', '')::integer;
    if pid = any(seen) then raise exception 'A post can appear only once per batch'; end if;
    seen := seen || pid;
    select i.tone, i.headline, i.new_visibility into v_tone, v_headline, v_visibility from private_reporting.check_outcome_info(code) i;
    if v_tone is null then raise exception 'Invalid outcome'; end if;
    if code = 'deleted_from_nd' and char_length(trim(notes)) < 10 then raise exception 'Explicit removal evidence is required'; end if;
    if comments is not null and comments < 0 then raise exception 'Invalid comment count'; end if;
    select * into p from public.reporting_publications where id = pid and organization_id = org for update;
    if p.id is null then raise exception 'Post not found'; end if;

    checked := clock_timestamp();
    obs := null;
    if v_visibility is not null then
      insert into public.reporting_observations(organization_id, publication_id, visibility, observed_at, comments_total, comments_complete, notes, created_by)
        values (org, pid, v_visibility, checked, comments, false, notes, auth.uid()) returning id into obs;
      update public.reporting_publications set visibility = v_visibility, last_observed_at = checked, comments_total = coalesce(comments, comments_total) where id = pid;
    end if;
    update public.reporting_publications set last_check_outcome = code, last_checked_at = checked where id = pid;
    insert into public.reporting_post_checks(organization_id, publication_id, outcome, tone, message, notes, checked_at, comments_total, observation_id, created_by)
      values (org, pid, code, v_tone, v_headline, notes, checked, comments, obs, auth.uid());

    recorded := recorded + 1;
    if v_tone = 'positive' then positive_count := positive_count + 1;
    elsif v_tone = 'negative' then negative_count := negative_count + 1;
    else attention_count := attention_count + 1; end if;
    last_pub := pid; last_title := p.title; last_label := p.account_label; last_headline := v_headline; last_tone := v_tone;
  end loop;

  if recorded = 1 then
    insert into public.reporting_notifications(organization_id, publication_id, kind, tone, title, message, check_count)
      values (org, last_pub, 'check_result', last_tone, last_headline, left(format('%s (%s)', last_title, last_label), 400), 1);
  else
    insert into public.reporting_notifications(organization_id, publication_id, kind, tone, title, message, check_count)
      values (org, null, 'check_batch',
        case when negative_count > 0 then 'negative' when attention_count > 0 then 'attention' else 'positive' end,
        format('%s post checks recorded', recorded),
        format('%s alive · %s removed or not accessible · %s need attention', positive_count, negative_count, attention_count), recorded);
  end if;
  return recorded;
end;
$$;

create function public.reporting_mark_notifications_seen(org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private_reporting.is_member(org) then raise exception 'Not authorized'; end if;
  insert into public.reporting_notification_state(organization_id, user_id, last_seen_at) values (org, auth.uid(), now())
    on conflict (organization_id, user_id) do update set last_seen_at = excluded.last_seen_at;
end;
$$;

revoke all on public.reporting_post_checks, public.reporting_notifications, public.reporting_notification_state from public, anon, authenticated;
grant select on public.reporting_post_checks, public.reporting_notifications, public.reporting_notification_state to authenticated;

revoke execute on function private_reporting.check_outcome_info(text), public.reporting_record_checks(uuid, jsonb, text), public.reporting_mark_notifications_seen(uuid) from public, anon, authenticated;
grant execute on function public.reporting_record_checks(uuid, jsonb, text), public.reporting_mark_notifications_seen(uuid) to authenticated;

comment on table public.reporting_post_checks is 'Append-only post check results. A check that could not be completed never changes visibility. source auto_check is reserved for a future approved worker; no automatic checker writes here yet.';
comment on table public.reporting_notifications is 'In-app notifications created together with check results. Visibility follows the underlying post.';

notify pgrst, 'reload schema';
