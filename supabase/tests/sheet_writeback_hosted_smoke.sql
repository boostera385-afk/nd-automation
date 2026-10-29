-- Authorized rollback-only hosted smoke for the sheet writeback outbox protocol.
-- Uses an existing verified owner/admin; no users/memberships are created and
-- every fixture insert rolls back with the transaction. No Sheet is contacted:
-- this exercises only the database protocol (lease-expiry timing is covered by
-- local PGlite tests because hosted time cannot be shifted safely).
begin;
do $$
declare actor uuid; business uuid; declared_item uuid;
  request uuid := gen_random_uuid(); stable text := 'smoke-'||gen_random_uuid()::text;
  intent jsonb; changed jsonb; first jsonb; denied boolean;
  claim_request uuid := gen_random_uuid(); claimed jsonb; lease uuid; acked jsonb;
  conflict_item uuid; cancel_item uuid; last_item uuid; cancelled jsonb;
  attempt integer; exhausted jsonb;
begin
  select m.user_id, m.organization_id into actor, business
    from public.reporting_memberships m join auth.users u on u.id=m.user_id
    where m.role in ('owner','admin') and u.email_confirmed_at is not null
    order by m.organization_id, m.user_id limit 1;
  if actor is null then raise exception 'Smoke prerequisite: existing verified owner/admin required'; end if;
  intent := jsonb_build_object('action','append','tab','Smoke fixture tab','rowRef',null,
    'values',jsonb_build_array(jsonb_build_object('Profile Name','Fixture','Status','Filled')));
  changed := jsonb_set(intent,'{values,0,Status}','"Other"'::jsonb);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';

  first := public.reporting_enqueue_sheet_writeback_v1(business,intent,stable,request);
  if public.reporting_enqueue_sheet_writeback_v1(business,intent,stable,request) is distinct from first
    or (first->>'status') <> 'pending' then raise exception 'Enqueue replay mismatch'; end if;
  declared_item := (first->>'id')::uuid;
  denied := false;
  begin perform public.reporting_enqueue_sheet_writeback_v1(business,changed,stable,request);
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Changed payload accepted under same request ID'; end if;
  if public.reporting_enqueue_sheet_writeback_v1(business,intent,stable,gen_random_uuid()) is distinct from first
    then raise exception 'Identical stable key created a second copy'; end if;
  denied := false;
  begin perform public.reporting_enqueue_sheet_writeback_v1(business,changed,stable,gen_random_uuid());
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Different payload accepted under same stable key'; end if;
  denied := false;
  begin perform public.reporting_enqueue_sheet_writeback_v1(business,jsonb_build_object('action','drop'),stable,gen_random_uuid());
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Invalid intent accepted'; end if;
  denied := false;
  begin perform public.reporting_enqueue_sheet_writeback_v1(gen_random_uuid(),intent,stable,gen_random_uuid());
  exception when insufficient_privilege then denied := true; when raise_exception then denied := true; end;
  if not denied then raise exception 'Foreign business enqueue accepted'; end if;

  claimed := public.reporting_claim_sheet_writeback_v1(business,1,claim_request);
  if jsonb_array_length(claimed) <> 1 then raise exception 'Claim returned no batch'; end if;
  lease := (claimed->0->>'leaseToken')::uuid;
  if public.reporting_claim_sheet_writeback_v1(business,1,claim_request) is distinct from claimed
    then raise exception 'Claim replay reissued the batch'; end if;
  denied := false;
  begin perform public.reporting_claim_sheet_writeback_v1(business,2,claim_request);
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Claim replay with different limit accepted'; end if;
  denied := false;
  begin perform public.reporting_ack_sheet_writeback_v1(business,declared_item,gen_random_uuid(),'delivered',null,null,gen_random_uuid());
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Wrong lease acknowledged'; end if;
  acked := public.reporting_ack_sheet_writeback_v1(business,declared_item,lease,'delivered',jsonb_build_object('row',7),null,gen_random_uuid());
  if (acked->>'status') <> 'delivered' then raise exception 'Delivery not recorded'; end if;
  if public.reporting_ack_sheet_writeback_v1(business,declared_item,lease,'delivered',jsonb_build_object('row',7),null,gen_random_uuid()) is distinct from acked
    then raise exception 'Lost ack response not idempotent'; end if;
  denied := false;
  begin perform public.reporting_ack_sheet_writeback_v1(business,declared_item,lease,'retry',null,'Reopen',gen_random_uuid());
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Terminal outcome rewritten'; end if;

  conflict_item := (public.reporting_enqueue_sheet_writeback_v1(business,intent,'smoke-'||gen_random_uuid()::text,gen_random_uuid())->>'id')::uuid;
  acked := public.reporting_ack_sheet_writeback_v1(business,conflict_item,
    (public.reporting_claim_sheet_writeback_v1(business,1,gen_random_uuid())->0->>'leaseToken')::uuid,
    'conflict',null,'Row moved',gen_random_uuid());
  if (acked->>'status') <> 'conflict' or not exists(
    select 1 from public.reporting_sheet_writeback_outbox where id=conflict_item and status='conflict' and last_error='Row moved')
    then raise exception 'Conflict not terminal'; end if;

  cancel_item := (public.reporting_enqueue_sheet_writeback_v1(business,intent,'smoke-'||gen_random_uuid()::text,gen_random_uuid())->>'id')::uuid;
  for attempt in 1..5 loop
    acked := public.reporting_ack_sheet_writeback_v1(business,cancel_item,
      (public.reporting_claim_sheet_writeback_v1(business,1,gen_random_uuid())->0->>'leaseToken')::uuid,
      'retry',null,'Sheet busy',gen_random_uuid());
    if (acked->>'status') <> 'retry' then raise exception 'Transient retry not accepted'; end if;
  end loop;
  exhausted := public.reporting_claim_sheet_writeback_v1(business,1,gen_random_uuid());
  if jsonb_array_length(exhausted) <> 0 or not exists(
    select 1 from public.reporting_sheet_writeback_outbox where id=cancel_item and status='failed' and last_error='Attempts exhausted')
    then raise exception 'Exhausted retries not terminal'; end if;

  last_item := (public.reporting_enqueue_sheet_writeback_v1(business,intent,'smoke-'||gen_random_uuid()::text,gen_random_uuid())->>'id')::uuid;
  cancelled := public.reporting_cancel_pending_sheet_writeback_v1(business,last_item,gen_random_uuid());
  if (cancelled->>'status') <> 'cancelled' then raise exception 'Cancel failed on pending item'; end if;
  denied := false;
  begin perform public.reporting_cancel_pending_sheet_writeback_v1(business,declared_item,gen_random_uuid());
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Non-pending cancellation accepted'; end if;

  denied := false;
  begin update public.reporting_sheet_writeback_outbox set status='delivered';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Direct mutation accepted'; end if;

  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  if exists(select 1 from public.reporting_sheet_writeback_outbox) then raise exception 'Nonmember read accepted'; end if;
  denied := false;
  begin perform public.reporting_claim_sheet_writeback_v1(business,1,gen_random_uuid());
  exception when insufficient_privilege then denied := true; when raise_exception then denied := true; end;
  if not denied then raise exception 'Nonmember claim accepted'; end if;

  execute 'reset role'; execute 'set local role anon';
  denied := false;
  begin perform public.reporting_enqueue_sheet_writeback_v1(business,intent,'smoke-anon',gen_random_uuid());
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anon enqueue accepted'; end if;
  denied := false;
  begin perform public.reporting_claim_sheet_writeback_v1(business,1,gen_random_uuid());
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anon claim accepted'; end if;
  execute 'reset role';
end $$;
select 'PASS: writeback enqueue/replay/stable-key/claim/lease/ack/conflict/exhaustion/cancel/RLS/anon checks; all fixtures rolled back' as result;
rollback;
