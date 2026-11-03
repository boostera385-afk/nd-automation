-- Catalog/pure-validation smoke after 005. No bytes, uploads or jobs.
begin read only;
do $$
declare name_ text;
begin
  if public.reporting_media_publisher_version() is distinct from 1
    or private_reporting.valid_approved_media('[]'::jsonb) is distinct from true
    or private_reporting.valid_approved_media('[{}]'::jsonb) is distinct from false
    then raise exception '005: version/descriptor validation mismatch'; end if;
  if not has_function_privilege('authenticated','public.reporting_media_publisher_version()','EXECUTE')
    or has_function_privilege('anon','public.reporting_media_publisher_version()','EXECUTE')
    or not has_function_privilege('anon','public.reporting_claim_publish_v2(text)','EXECUTE')
    or not has_function_privilege('authenticated','public.reporting_claim_publish_v2(text)','EXECUTE')
    then raise exception '005: public function access mismatch'; end if;
  foreach name_ in array array['private_reporting.valid_approved_media(jsonb)','private_reporting.valid_draft_content(jsonb)',
      'private_reporting.reporting_claim_publish(text)'] loop
    if has_function_privilege('anon',name_,'EXECUTE') or has_function_privilege('authenticated',name_,'EXECUTE')
      then raise exception '005: private helper exposed'; end if;
  end loop;
  if position('nd.publisher_media' in pg_get_functiondef('private_reporting.reporting_claim_publish(text)'::regprocedure))=0
    then raise exception '005: media capability gate absent'; end if;
end $$;
select 'PASS: 005 catalog/pure-validation media smoke; worker/live acceptance separate' as result;
rollback;
