-- Durable Sheet writeback outbox protocol. Additive: no existing table,
-- publishing/worker function or credential is replaced or granted. Delivery to
-- any real Sheet stays a separate, still-unwired client/connector concern; this
-- migration only records ordered, replay-safe write intents and their outcomes.
create function private_reporting.sheet_writeback_access(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.reporting_memberships m join auth.users u on u.id=m.user_id
    where m.organization_id=org and m.user_id=auth.uid() and u.email_confirmed_at is not null
      and m.role in ('owner','admin','operator'))
$$;
revoke all on function private_reporting.sheet_writeback_access(uuid) from public,anon;
grant execute on function private_reporting.sheet_writeback_access(uuid) to authenticated;

create function private_reporting.valid_writeback_intent(intent jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; key text; action text; rows_ jsonb; ri int;
begin
  if intent is null or jsonb_typeof(intent)<>'object' or octet_length(intent::text)>65536
    or (select count(*) from jsonb_object_keys(intent))<>4
    or not (intent ?& array['action','tab','rowRef','values']) then return false; end if;
  action := intent->>'action';
  if action not in ('append','update_cells') then return false; end if;
  if jsonb_typeof(intent->'tab')<>'string' or char_length(intent->>'tab') not between 1 and 80
    or (intent->>'tab') ~ '[[:cntrl:]]' then return false; end if;
  if action='append' then
    if jsonb_typeof(intent->'rowRef')<>'null' then return false; end if;
  elsif jsonb_typeof(intent->'rowRef')<>'string' or char_length(intent->>'rowRef') not between 1 and 300
    or (intent->>'rowRef') ~ '[[:cntrl:]]' then return false; end if;
  rows_ := intent->'values';
  if jsonb_typeof(rows_)<>'array' or jsonb_array_length(rows_) not between 1 and 50 then return false; end if;
  for ri in select generate_series(1,jsonb_array_length(rows_)) loop
    item := rows_->(ri-1);
    if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))>100 then return false; end if;
    for key in select jsonb_object_keys(item) loop
      if char_length(key)>100 or key ~ '[[:cntrl:]]' then return false; end if;
      if jsonb_typeof(item->key) not in ('string','null') then return false; end if;
      if jsonb_typeof(item->key)='string' and (char_length(item->key#>>'{}')>4000 or (item->key#>>'{}') ~ '[[:cntrl:]]') then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
revoke all on function private_reporting.valid_writeback_intent(jsonb) from public,anon,authenticated;

create table public.reporting_sheet_writeback_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  request_id uuid not null,
  stable_key text not null check (char_length(stable_key) between 1 and 200),
  seq bigint generated always as identity,
  intent jsonb not null check (private_reporting.valid_writeback_intent(intent)),
  status text not null default 'pending' check (status in ('pending','leased','delivered','conflict','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text check (last_error is null or char_length(last_error)<=500),
  delivery_receipt jsonb check (delivery_receipt is null or octet_length(delivery_receipt::text)<=8192),
  delivered_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, seq),
  unique (organization_id, request_id),
  unique (organization_id, stable_key)
);
create index reporting_writeback_queue on public.reporting_sheet_writeback_outbox(organization_id, status, seq);
create index reporting_writeback_lease_expiry on public.reporting_sheet_writeback_outbox(organization_id, lease_expires_at) where status = 'leased';

create table public.reporting_sheet_writeback_claims (
  organization_id uuid not null references public.reporting_organizations(id) on delete cascade,
  request_id uuid not null,
  batch_limit integer not null check (batch_limit between 1 and 50),
  claimed jsonb not null,
  claimed_at timestamptz not null default now(),
  primary key (organization_id, request_id)
);

create table public.reporting_sheet_writeback_acks (
  organization_id uuid not null,
  outbox_id uuid not null,
  request_id uuid not null,
  outcome text not null check (outcome in ('delivered','conflict','failed','retry')),
  receipt jsonb check (receipt is null or octet_length(receipt::text)<=8192),
  detail text check (detail is null or char_length(detail)<=500),
  processed jsonb not null,
  at timestamptz not null default now(),
  primary key (organization_id, outbox_id, request_id),
  foreign key (organization_id, outbox_id) references public.reporting_sheet_writeback_outbox(organization_id, id) on delete cascade
);

alter table public.reporting_sheet_writeback_outbox enable row level security;
alter table public.reporting_sheet_writeback_claims enable row level security;
alter table public.reporting_sheet_writeback_acks enable row level security;
create policy writeback_outbox_staff_read on public.reporting_sheet_writeback_outbox for select to authenticated using (private_reporting.sheet_writeback_access(organization_id));
create policy writeback_claims_staff_read on public.reporting_sheet_writeback_claims for select to authenticated using (private_reporting.sheet_writeback_access(organization_id));
create policy writeback_acks_staff_read on public.reporting_sheet_writeback_acks for select to authenticated using (private_reporting.sheet_writeback_access(organization_id));
revoke all on public.reporting_sheet_writeback_outbox,public.reporting_sheet_writeback_claims,public.reporting_sheet_writeback_acks from public,anon,authenticated;
grant select on public.reporting_sheet_writeback_outbox,public.reporting_sheet_writeback_claims,public.reporting_sheet_writeback_acks to authenticated;

create function private_reporting.enqueue_sheet_writeback(org uuid, intent jsonb, p_stable_key text, request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.reporting_sheet_writeback_outbox;
begin
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if request is null or p_stable_key is null or btrim(p_stable_key)='' or char_length(p_stable_key)>200
    or not private_reporting.valid_writeback_intent(intent) then raise exception 'Invalid writeback request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,20261030));
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select * into row from public.reporting_sheet_writeback_outbox where organization_id=org and request_id=request;
  if row.id is not null then
    if row.stable_key <> p_stable_key or row.intent <> intent then raise exception 'Writeback replay conflict'; end if;
    return jsonb_build_object('id',row.id,'seq',row.seq,'status',row.status);
  end if;
  select * into row from public.reporting_sheet_writeback_outbox where organization_id=org and stable_key=p_stable_key;
  if row.id is not null then
    -- identical stable key is the same logical write: return the recorded row, never a second copy.
    if row.intent <> intent then raise exception 'Writeback stable key conflict'; end if;
    return jsonb_build_object('id',row.id,'seq',row.seq,'status',row.status);
  end if;
  insert into public.reporting_sheet_writeback_outbox(organization_id,request_id,stable_key,intent,created_by)
    values(org,request,p_stable_key,intent,auth.uid()) returning * into row;
  return jsonb_build_object('id',row.id,'seq',row.seq,'status',row.status);
end $$;

create function private_reporting.claim_sheet_writeback(org uuid, batch_limit integer, request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prior public.reporting_sheet_writeback_claims; item public.reporting_sheet_writeback_outbox;
  token uuid; claimed_items jsonb := '[]'::jsonb;
begin
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if request is null or batch_limit is null or batch_limit not between 1 and 50 then raise exception 'Invalid claim request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,20261030));
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select * into prior from public.reporting_sheet_writeback_claims where organization_id=org and request_id=request for update;
  if prior.request_id is not null then
    -- identical claim replay returns the same leases; no second batch is handed out.
    if prior.batch_limit <> batch_limit then raise exception 'Writeback claim replay conflict'; end if;
    return prior.claimed;
  end if;
  for item in select * from public.reporting_sheet_writeback_outbox
      where organization_id=org and (status='pending' or (status='leased' and lease_expires_at < now()))
      order by seq limit batch_limit for update skip locked
  loop
    if item.attempts >= 5 then
      update public.reporting_sheet_writeback_outbox set status='failed', last_error='Attempts exhausted',
        lease_token=null, lease_expires_at=null where id=item.id;
    else
      token := gen_random_uuid();
      update public.reporting_sheet_writeback_outbox set status='leased', attempts=attempts+1,
        lease_token=token, lease_expires_at=now()+interval '2 minutes'
        where id=item.id and organization_id=org
          and (status='pending' or (status='leased' and lease_expires_at < now()));
      if found then
        claimed_items := claimed_items || jsonb_build_object('id',item.id,'seq',item.seq,'intent',item.intent,
          'leaseToken',token,'expiresAt',now()+interval '2 minutes','attempts',item.attempts+1);
      end if;
    end if;
  end loop;
  insert into public.reporting_sheet_writeback_claims(organization_id,request_id,batch_limit,claimed)
    values(org,request,batch_limit,claimed_items);
  return claimed_items;
end $$;

create function private_reporting.ack_sheet_writeback(org uuid, item uuid, lease uuid, outcome text, receipt jsonb, detail text, request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.reporting_sheet_writeback_outbox; prior public.reporting_sheet_writeback_acks; result jsonb; recorded text;
begin
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if request is null or item is null or outcome not in ('delivered','conflict','failed','retry') then raise exception 'Invalid ack request'; end if;
  if detail is not null and (char_length(detail)>500 or detail ~ '[[:cntrl:]]') then raise exception 'Invalid ack detail'; end if;
  if receipt is not null and (jsonb_typeof(receipt)<>'object' or octet_length(receipt::text)>8192
    or (select count(*) from jsonb_object_keys(receipt))>20) then raise exception 'Invalid ack receipt'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,20261030));
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select * into prior from public.reporting_sheet_writeback_acks where organization_id=org and outbox_id=item and request_id=request;
  if prior.request_id is not null then
    if prior.outcome <> outcome or prior.receipt is distinct from receipt then raise exception 'Writeback ack replay conflict'; end if;
    return prior.processed;
  end if;
  select * into row from public.reporting_sheet_writeback_outbox where organization_id=org and id=item for update;
  if row.id is null then raise exception 'Writeback item not found'; end if;
  if row.status in ('delivered','conflict','failed') then
    -- terminal: a lost ack response may be re-sent with a fresh request ID. The
    -- same outcome is idempotent; a different one never rewrites history.
    recorded := case row.status when 'delivered' then 'delivered' when 'conflict' then 'conflict' else 'failed' end;
    if outcome <> recorded then raise exception 'Writeback ack outcome conflict'; end if;
    result := jsonb_build_object('id',row.id,'status',row.status);
  elsif row.status <> 'leased' or row.lease_token is distinct from lease then
    raise exception 'Writeback ack lease conflict';
  else
    if outcome='delivered' then
      update public.reporting_sheet_writeback_outbox set status='delivered', delivery_receipt=receipt,
        delivered_at=now(), lease_token=null, lease_expires_at=null, last_error=null where id=row.id;
    elsif outcome='conflict' then
      update public.reporting_sheet_writeback_outbox set status='conflict',
        last_error=coalesce(detail,'Sheet conflict'), lease_token=null, lease_expires_at=null where id=row.id;
    elsif outcome='failed' then
      update public.reporting_sheet_writeback_outbox set status='failed',
        last_error=coalesce(detail,'Delivery failed'), lease_token=null, lease_expires_at=null where id=row.id;
    else
      update public.reporting_sheet_writeback_outbox set status='pending',
        last_error=coalesce(detail,'Retry requested'), lease_token=null, lease_expires_at=null where id=row.id;
    end if;
    result := jsonb_build_object('id',row.id,'status',outcome);
  end if;
  insert into public.reporting_sheet_writeback_acks(organization_id,outbox_id,request_id,outcome,receipt,detail,processed)
    values(org,item,request,outcome,receipt,detail,result);
  return result;
end $$;

create function private_reporting.cancel_sheet_writeback(org uuid, item uuid, request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.reporting_sheet_writeback_outbox;
begin
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  if item is null or request is null then raise exception 'Invalid cancel request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,20261030));
  if not private_reporting.sheet_writeback_access(org) then raise exception 'Verified staff required' using errcode='42501'; end if;
  select * into row from public.reporting_sheet_writeback_outbox where organization_id=org and id=item and status='pending' for update;
  if row.id is null then raise exception 'Only pending writeback can be cancelled'; end if;
  update public.reporting_sheet_writeback_outbox set status='cancelled' where id=row.id;
  return jsonb_build_object('id',row.id,'status','cancelled');
end $$;

revoke all on function private_reporting.enqueue_sheet_writeback(uuid,jsonb,text,uuid),
  private_reporting.claim_sheet_writeback(uuid,integer,uuid),
  private_reporting.ack_sheet_writeback(uuid,uuid,uuid,text,jsonb,text,uuid),
  private_reporting.cancel_sheet_writeback(uuid,uuid,uuid) from public,anon;
grant execute on function private_reporting.enqueue_sheet_writeback(uuid,jsonb,text,uuid),
  private_reporting.claim_sheet_writeback(uuid,integer,uuid),
  private_reporting.ack_sheet_writeback(uuid,uuid,uuid,text,jsonb,text,uuid),
  private_reporting.cancel_sheet_writeback(uuid,uuid,uuid) to authenticated;

create function public.reporting_enqueue_sheet_writeback_v1(org uuid, intent jsonb, stable_key text, request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private_reporting.enqueue_sheet_writeback(org,intent,stable_key,request_id) $$;
create function public.reporting_claim_sheet_writeback_v1(org uuid, batch_limit integer, request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private_reporting.claim_sheet_writeback(org,batch_limit,request_id) $$;
create function public.reporting_ack_sheet_writeback_v1(org uuid, item_id uuid, lease_token uuid, outcome text, receipt jsonb, detail text, request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private_reporting.ack_sheet_writeback(org,item_id,lease_token,outcome,receipt,detail,request_id) $$;
create function public.reporting_cancel_pending_sheet_writeback_v1(org uuid, item_id uuid, request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private_reporting.cancel_sheet_writeback(org,item_id,request_id) $$;

revoke all on function public.reporting_enqueue_sheet_writeback_v1(uuid,jsonb,text,uuid),
  public.reporting_claim_sheet_writeback_v1(uuid,integer,uuid),
  public.reporting_ack_sheet_writeback_v1(uuid,uuid,uuid,text,jsonb,text,uuid),
  public.reporting_cancel_pending_sheet_writeback_v1(uuid,uuid,uuid) from public,anon;
grant execute on function public.reporting_enqueue_sheet_writeback_v1(uuid,jsonb,text,uuid),
  public.reporting_claim_sheet_writeback_v1(uuid,integer,uuid),
  public.reporting_ack_sheet_writeback_v1(uuid,uuid,uuid,text,jsonb,text,uuid),
  public.reporting_cancel_pending_sheet_writeback_v1(uuid,uuid,uuid) to authenticated;
