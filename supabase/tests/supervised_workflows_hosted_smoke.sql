-- Catalog-only smoke after 007. Never queues/claims account or content actions.
begin read only;
do $$
declare name_ text;
begin
  if public.reporting_supervised_workflow_version() is distinct from 1
    or not has_function_privilege('authenticated','public.reporting_supervised_workflow_version()','EXECUTE')
    or has_function_privilege('anon','public.reporting_supervised_workflow_version()','EXECUTE')
    or not has_function_privilege('authenticated','public.reporting_enqueue_supervised_workflow(uuid,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.reporting_enqueue_supervised_workflow(uuid,uuid,jsonb,boolean)','EXECUTE')
    then raise exception '007: staff workflow access/version mismatch'; end if;
  foreach name_ in array array['public.reporting_claim_automation_task(text)','public.reporting_claim_supervised_workflow(text)'] loop
    if not has_function_privilege('anon',name_,'EXECUTE') or not has_function_privilege('authenticated',name_,'EXECUTE')
      then raise exception '007: scoped-token claimant access mismatch'; end if;
  end loop;
  foreach name_ in array array['private_reporting.valid_workflow_manifest(jsonb)','private_reporting.workflow_target_current(uuid,uuid,jsonb)',
      'private_reporting.claim_browser_task(text,boolean)','private_reporting.reporting_claim_automation_task(text)',
      'private_reporting.validate_workflow_result()'] loop
    if has_function_privilege('anon',name_,'EXECUTE') or has_function_privilege('authenticated',name_,'EXECUTE')
      then raise exception '007: private workflow helper exposed'; end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.reporting_automation_tasks'::regclass
      and tgname='supervised_workflow_result' and tgenabled='O')
    or not exists(select 1 from pg_constraint where conrelid='public.reporting_automation_tasks'::regclass
      and conname='reporting_automation_tasks_kind_check' and position('supervised_workflow' in pg_get_constraintdef(oid))>0)
    then raise exception '007: workflow kind/result guard absent'; end if;
end $$;
select 'PASS: 007 catalog-only workflow smoke; authorization/live acceptance separate' as result;
rollback;
