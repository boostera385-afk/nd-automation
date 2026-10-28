-- Authorized hosted smoke: use an existing verified staff member, never create
-- users/memberships. All fixture inserts are rolled back. No source data output.
begin;
do $$
declare actor uuid; workspace uuid; receipts jsonb; replay jsonb; changed jsonb;
  fixture_id text := 'nd-intake-smoke-' || gen_random_uuid()::text;
  value jsonb; denied boolean;
begin
  select m.user_id,m.organization_id into actor,workspace
    from public.reporting_memberships m join auth.users u on u.id=m.user_id
    where m.role in ('owner','admin','operator') and u.email_confirmed_at is not null
    order by m.organization_id,m.user_id limit 1;
  if actor is null then raise exception 'Smoke prerequisite: existing verified staff required'; end if;
  value := jsonb_build_array(jsonb_build_object('source','google','source_review_id',fixture_id,
    'observed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload',jsonb_build_object('text','Disposable transactional intake fixture.','rating',5,
      'author','','business_name','','place_id','','source_url','https://example.test/intake-fixture',
      'photo_urls','[]'::jsonb,'display_date','')));
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  receipts := public.reporting_ingest_fudge_reviews_v1(workspace,value);
  replay := public.reporting_ingest_fudge_reviews_v1(workspace,value);
  if jsonb_array_length(receipts) <> 1 or (receipts->0->>'revision')::integer <> 1
    or receipts->0->>'inserted_record' <> 'true' or receipts->0->>'inserted_revision' <> 'true'
    or replay->0->>'record_id' <> receipts->0->>'record_id'
    or replay->0->>'revision_id' <> receipts->0->>'revision_id'
    or replay->0->>'inserted_record' <> 'false' or replay->0->>'inserted_revision' <> 'false'
    then raise exception 'Receipt/replay assertion failed'; end if;
  changed := public.reporting_ingest_fudge_reviews_v1(workspace,
    jsonb_set(value,'{0,payload,text}','"Changed disposable fixture."'::jsonb));
  if (changed->0->>'revision')::integer <> 2
    or changed->0->>'record_id' <> receipts->0->>'record_id'
    or changed->0->>'revision_id' = receipts->0->>'revision_id'
    then raise exception 'Changed revision assertion failed'; end if;
  if (select payload->>'text' from public.reporting_fudge_revisions
      where id=(receipts->0->>'revision_id')::uuid) <> 'Disposable transactional intake fixture.'
    then raise exception 'Original preservation assertion failed'; end if;
  denied := false;
  begin perform public.reporting_ingest_fudge_reviews_v1(gen_random_uuid(),value);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Cross-workspace denial failed'; end if;
  denied := false;
  begin insert into public.reporting_fudge_records default values;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Direct insert denial failed'; end if;
  denied := false;
  begin update public.reporting_fudge_revisions set payload=payload;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Direct update denial failed'; end if;
  denied := false;
  begin delete from public.reporting_fudge_records;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Direct delete denial failed'; end if;
  -- Failed later batch element must not leave its earlier identity inserted.
  denied := false;
  begin
    perform public.reporting_ingest_fudge_reviews_v1(workspace,
      jsonb_set(value,'{0,source_review_id}',to_jsonb(fixture_id || '-atomic')) ||
      jsonb_build_array(jsonb_set(value->0,'{source_review_id}','"invalid identity"'::jsonb)));
  exception when raise_exception then denied := true; end;
  if not denied or exists(select 1 from public.reporting_fudge_records where source_review_id=fixture_id || '-atomic')
    then raise exception 'Atomic rejection assertion failed'; end if;
  -- A random subject has no membership, and cannot read the known fixture.
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  if exists(select 1 from public.reporting_fudge_records where id=(receipts->0->>'record_id')::uuid)
    then raise exception 'RLS cross-subject denial failed'; end if;
  denied := false;
  begin perform public.reporting_ingest_fudge_reviews_v1(workspace,value);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Nonmember intake denial failed'; end if;
  execute 'reset role';
  execute 'set local role anon';
  denied := false;
  begin perform public.reporting_ingest_fudge_reviews_v1(workspace,value);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anonymous intake denial failed'; end if;
  execute 'reset role';
end $$;
rollback;
select 'PASS: intake/replay/revisions/originals/atomicity/RLS/privilege denials; all fixtures rolled back' as smoke_result;
