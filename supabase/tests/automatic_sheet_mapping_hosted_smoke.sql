-- Catalog-only smoke after 004. Does not enqueue or deliver any Sheet intent.
begin read only;
do $$
declare name_ text; table_ oid;
begin
  if public.reporting_sheet_mapping_version() is distinct from 1 then raise exception '004: version mismatch'; end if;
  foreach name_ in array array['reporting_sheet_publication_mappings','reporting_sheet_publish_targets','reporting_sheet_delivery_events'] loop
    table_ := ('public.'||name_)::regclass;
    if not (select relrowsecurity from pg_class where oid=table_)
      or not has_table_privilege('authenticated',table_,'SELECT')
      or has_table_privilege('authenticated',table_,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('anon',table_,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or not exists(select 1 from pg_policies where schemaname='public' and tablename=name_ and cmd='SELECT' and roles=array['authenticated']::name[])
      then raise exception '004: mapping table access/policy mismatch'; end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.reporting_post_checks'::regclass and tgname='reporting_check_sheet_outbox' and tgenabled='O')
    or not exists(select 1 from pg_trigger where tgrelid='public.reporting_publish_jobs'::regclass and tgname='reporting_publish_sheet_outbox' and tgenabled='O')
    then raise exception '004: mapping trigger missing/disabled'; end if;
  foreach name_ in array array['public.reporting_set_publication_sheet_mapping(uuid,uuid,text,uuid,integer,boolean)',
      'public.reporting_set_publish_sheet_target(uuid,uuid,boolean,boolean)','public.reporting_sheet_mapping_version()'] loop
    if not has_function_privilege('authenticated',name_,'EXECUTE') or has_function_privilege('anon',name_,'EXECUTE')
      then raise exception '004: public function access mismatch'; end if;
  end loop;
  foreach name_ in array array['private_reporting.map_check_to_sheet()','private_reporting.map_publication_to_sheet()',
      'private_reporting.sheet_mapping_owner_active(uuid,uuid)'] loop
    if has_function_privilege('anon',name_,'EXECUTE') or has_function_privilege('authenticated',name_,'EXECUTE')
      then raise exception '004: private helper exposed'; end if;
  end loop;
end $$;
select 'PASS: 004 catalog-only mapping smoke; behavior/live acceptance separate' as result;
rollback;
