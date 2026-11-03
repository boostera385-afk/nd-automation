-- Catalog-only smoke after 003. Run on the reviewed target as an administrator.
-- No jobs, credentials, sessions or customer fixtures are created or claimed.
begin read only;
do $$
declare table_ oid := 'public.reporting_publish_batches'::regclass;
begin
  if public.reporting_publish_scheduling_version() is distinct from 1
    or not (select relrowsecurity from pg_class where oid=table_)
    or not has_table_privilege('authenticated',table_,'SELECT')
    or has_table_privilege('authenticated',table_,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_table_privilege('anon',table_,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    then raise exception '003: batch table access/version mismatch'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='reporting_publish_batches'
      and policyname='publish_batches_staff_read' and cmd='SELECT' and roles=array['authenticated']::name[])
    or not exists(select 1 from pg_attribute where attrelid='public.reporting_publish_jobs'::regclass and attname='not_before' and attnotnull and not attisdropped)
    or not exists(select 1 from pg_attribute where attrelid='public.reporting_publish_jobs'::regclass and attname='dispatch_until' and not attisdropped)
    or not exists(select 1 from pg_constraint where conrelid='public.reporting_publish_jobs'::regclass and conname='reporting_publish_dispatch_window')
    then raise exception '003: schedule columns, constraint or policy missing'; end if;
  if not has_function_privilege('authenticated','public.reporting_enqueue_publish_batch(uuid,uuid,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.reporting_publish_scheduling_version()','EXECUTE')
    or has_function_privilege('anon','public.reporting_enqueue_publish_batch(uuid,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.reporting_publish_scheduling_version()','EXECUTE')
    or has_function_privilege('anon','private_reporting.reporting_claim_publish(text)','EXECUTE')
    or has_function_privilege('authenticated','private_reporting.reporting_claim_publish(text)','EXECUTE')
    then raise exception '003: function access mismatch'; end if;
end $$;
select 'PASS: 003 catalog-only scheduling smoke; behavior/live acceptance separate' as result;
rollback;
