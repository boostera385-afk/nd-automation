-- Optional immutable media descriptors only. No bucket, URL fetch or media bytes.
create function private_reporting.valid_approved_media(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; ids uuid[] := '{}'; total bigint := 0;
begin
  if value is null then return true; end if; -- Legacy text revisions have no key.
  if jsonb_typeof(value)<>'array' or jsonb_array_length(value)>10 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>7
      or not(item ?& array['id','sha256','bytes','mime','name','rightsConfirmed','privacyReviewed'])
      or jsonb_typeof(item->'id')<>'string' or (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'sha256')<>'string' or (item->>'sha256') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(item->'bytes')<>'number' or (item->>'bytes') !~ '^[1-9][0-9]{0,7}$'
      or (item->>'bytes')::bigint>8388608
      or jsonb_typeof(item->'mime')<>'string' or item->>'mime' not in ('image/jpeg','image/png','image/webp')
      or jsonb_typeof(item->'name')<>'string' or item->>'name' !~ '^[A-Za-z0-9_-]{1,80}[.](jpg|png|webp)$'
      or item->'rightsConfirmed'<>'true'::jsonb or item->'privacyReviewed'<>'true'::jsonb then return false; end if;
    if (item->>'id')::uuid=any(ids) then return false; end if;
    if (item->>'mime'='image/jpeg' and item->>'name' !~ '[.]jpg$') or (item->>'mime'='image/png' and item->>'name' !~ '[.]png$')
      or (item->>'mime'='image/webp' and item->>'name' !~ '[.]webp$') then return false; end if;
    ids := array_append(ids,(item->>'id')::uuid); total := total+(item->>'bytes')::bigint;
  end loop;
  return total<=31457280;
end $$;
revoke all on function private_reporting.valid_approved_media(jsonb) from public,anon,authenticated;

create or replace function private_reporting.valid_draft_content(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if value is null or jsonb_typeof(value)<>'object' or not(value ?& array['kind','title','body','audience','price_cents','category'])
    or exists(select 1 from jsonb_object_keys(value) k where k not in ('kind','title','body','audience','price_cents','category','media'))
    or not private_reporting.valid_approved_media(value->'media') then return false; end if;
  if jsonb_typeof(value->'kind')<>'string' or value->>'kind' not in ('post','listing')
    or jsonb_typeof(value->'title')<>'string' or char_length(trim(value->>'title')) not between 3 and 200
    or jsonb_typeof(value->'body')<>'string' or char_length(trim(value->>'body')) not between 1 and 5000
    or jsonb_typeof(value->'audience')<>'string' or value->>'audience' not in ('anyone','nearby','neighborhood') then return false; end if;
  if value->>'kind'='post' then return value->'price_cents'='null'::jsonb and value->'category'='null'::jsonb; end if;
  if jsonb_typeof(value->'price_cents')<>'number' or (value->>'price_cents')::numeric<0 or (value->>'price_cents')::numeric>1000000000
    or trunc((value->>'price_cents')::numeric)<>(value->>'price_cents')::numeric or jsonb_typeof(value->'category')<>'string'
    or char_length(trim(value->>'category')) not between 1 and 120 then return false; end if;
  return true;
end $$;
revoke all on function private_reporting.valid_draft_content(jsonb) from public,anon,authenticated;

-- Compatibility gate: an old/text-only worker must NEVER claim media. Keep all
-- existing session/revision/lease validation and enable capability only inside
-- the new credential-authenticated claimant's current transaction.
create or replace function private_reporting.reporting_claim_publish(credential text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.reporting_workers; j public.reporting_publish_jobs;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  if exists(select 1 from public.reporting_check_jobs where worker_id=w.id and status='leased')
    or exists(select 1 from public.reporting_publish_jobs where worker_id=w.id and status='leased') then return null; end if;
  update public.reporting_publish_jobs q set status='cancelled',failure_notes='Dispatch window expired; no automatic catch-up or submission.'
    where q.worker_id=w.id and q.status='pending' and q.dispatch_until<=clock_timestamp();
  update public.reporting_publish_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and exists(
    select 1 from public.reporting_work_sessions s where s.id=q.session_id and (s.status='closed' or s.started_at<=clock_timestamp()-interval '10 hours'));
  update public.reporting_publish_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and not exists(
    select 1 from public.reporting_content_drafts d join public.reporting_worker_profiles b on b.id=q.binding_id and b.organization_id=q.organization_id
    where d.id=q.draft_id and d.organization_id=q.organization_id and d.status='approved' and d.revision=q.draft_revision
      and d.content=q.content_snapshot and q.target_snapshot=jsonb_build_object('binding_id',b.id,'customer_id',b.customer_id,
        'worker_id',b.worker_id,'profile_id',b.profile_id,'account_label',b.account_label));
  select q.* into j from public.reporting_publish_jobs q
    join public.reporting_work_sessions s on s.id=q.session_id and s.organization_id=q.organization_id
    join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
    where q.worker_id=w.id and q.status='pending' and q.not_before<=clock_timestamp()
      and (q.dispatch_until is null or q.dispatch_until>clock_timestamp())
      and (current_setting('nd.publisher_media',true)='v1' or jsonb_array_length(coalesce(q.content_snapshot->'media','[]'::jsonb))=0)
      and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')
    order by q.not_before,q.created_at,q.id for update of q skip locked limit 1;
  if j.id is null then return null; end if;
  update public.reporting_publish_jobs set status='leased',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '10 minutes'
    where id=j.id returning * into j;
  return (case when current_setting('nd.publisher_media',true)='v1' then j.content_snapshot else j.content_snapshot-'media' end)
    || jsonb_build_object('job_id',j.id,'draft_id',j.draft_id,'draft_revision',j.draft_revision,
    'customer_id',j.target_snapshot->>'customer_id','profile_id',j.target_snapshot->>'profile_id','account_label',j.target_snapshot->>'account_label',
    'lease_token',j.lease_token,'lease_expires_at',j.lease_expires_at);
end $$;
revoke all on function private_reporting.reporting_claim_publish(text) from public,anon,authenticated;

create function public.reporting_claim_publish_v2(credential text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous text; result jsonb;
begin
  perform private_reporting.worker_for_token(credential);
  previous := current_setting('nd.publisher_media',true);
  perform set_config('nd.publisher_media','v1',true);
  result := public.reporting_claim_publish(credential);
  perform set_config('nd.publisher_media',coalesce(previous,''),true);
  return result;
end $$;
revoke all on function public.reporting_claim_publish_v2(text) from public,anon,authenticated;
grant execute on function public.reporting_claim_publish_v2(text) to anon,authenticated;
create function public.reporting_media_publisher_version() returns integer
language sql stable security invoker set search_path='' as $$ select 1; $$;
revoke all on function public.reporting_media_publisher_version() from public,anon,authenticated;
grant execute on function public.reporting_media_publisher_version() to authenticated;
notify pgrst,'reload schema';
