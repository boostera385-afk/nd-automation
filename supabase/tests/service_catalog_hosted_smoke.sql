-- Authorized rollback-only hosted smoke. Uses existing verified owner/admin.
-- No users/memberships, live source data, or production catalogs are imported.
begin;
do $$
declare actor uuid; business uuid; first jsonb; replay jsonb; second jsonb; published jsonb;
  rules jsonb; request uuid := gen_random_uuid(); activation uuid := gen_random_uuid(); denied boolean;
begin
  select m.user_id,m.organization_id into actor,business from public.reporting_memberships m
    join auth.users u on u.id=m.user_id where m.role in ('owner','admin') and u.email_confirmed_at is not null
    order by m.organization_id,m.user_id limit 1;
  if actor is null then raise exception 'Existing verified publisher required'; end if;
  if exists(select 1 from public.reporting_service_catalog_heads where organization_id=business)
    then raise exception 'Smoke requires no existing catalog for this business'; end if;
  rules := '[{"keyword":"Disposable fixture service","searchTerm":"fixture","family":"Fixture","subcategory":"Fixture","businessSignals":[],"reviewSignals":[],"requiredSignals":[],"topicSignals":[],"excludeSignals":[],"topicRequired":false,"collectFamilyInventory":false,"rewriteServicePhrase":"","equivalentServicePhrases":[]}]'::jsonb;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  first := public.reporting_save_service_catalog_v1(business,rules,0,request);
  replay := public.reporting_save_service_catalog_v1(business,rules,0,request);
  if first<>replay or (first->>'revision')::integer<>1 then raise exception 'Save/replay mismatch'; end if;
  if public.reporting_get_service_catalog_v1(business) is not null then raise exception 'Staging activated rules'; end if;
  denied := false;
  begin perform public.reporting_save_service_catalog_v1(business,rules,0,gen_random_uuid());
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Stale save accepted'; end if;
  second := public.reporting_save_service_catalog_v1(business,jsonb_set(rules,'{0,family}','"Changed fixture"'::jsonb),1,gen_random_uuid());
  published := public.reporting_activate_service_catalog_v1(business,(second->>'revisionId')::uuid,0,activation);
  if public.reporting_activate_service_catalog_v1(business,(second->>'revisionId')::uuid,0,activation)<>published then raise exception 'Activation replay mismatch'; end if;
  if (public.reporting_get_service_catalog_v1(business)->>'revision')::integer<>2 then raise exception 'Wrong active revision'; end if;
  denied := false;
  begin perform public.reporting_activate_service_catalog_v1(business,(first->>'revisionId')::uuid,0,gen_random_uuid());
  exception when raise_exception then denied := true; end;
  if not denied then raise exception 'Stale activation accepted'; end if;
  perform public.reporting_activate_service_catalog_v1(business,(first->>'revisionId')::uuid,1,gen_random_uuid());
  published := public.reporting_get_service_catalog_v1(business);
  if (published->>'generation')::integer<>2 or (published->>'revision')::integer<>1 or published->'rules'<>rules then raise exception 'Rollback/original preservation failed'; end if;
  denied := false;
  begin perform public.reporting_save_service_catalog_v1(gen_random_uuid(),rules,0,gen_random_uuid());
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Cross-business save accepted'; end if;
  denied := false;
  begin update public.reporting_service_catalog_heads set latest_revision=99;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Direct mutation accepted'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  if exists(select 1 from public.reporting_service_catalog_revisions) then raise exception 'RLS nonmember read accepted'; end if;
  denied := false;
  begin perform public.reporting_get_service_catalog_v1(business);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Nonmember RPC accepted'; end if;
  execute 'reset role'; execute 'set local role anon';
  denied := false;
  begin perform public.reporting_get_service_catalog_v1(business);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anon RPC accepted'; end if;
  execute 'reset role';
end $$;
select 'PASS: save/replay/version conflict/activation/rollback/original/RLS/anon/direct-write checks; all fixtures rolled back' as result;
rollback;
