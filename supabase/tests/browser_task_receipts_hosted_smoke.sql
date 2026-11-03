-- Catalog-only smoke after 006. Never completes/reconciles a real lease.
begin read only;
do $$
declare wrapper text := 'public.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text)';
  helper text := 'private_reporting.reporting_complete_automation_task(text,uuid,uuid,text,jsonb,text)';
  body_ text;
begin
  if not has_function_privilege('anon',wrapper,'EXECUTE') or not has_function_privilege('authenticated',wrapper,'EXECUTE')
    or has_function_privilege('anon',helper,'EXECUTE') or has_function_privilege('authenticated',helper,'EXECUTE')
    then raise exception '006: receipt wrapper/helper access mismatch'; end if;
  body_ := pg_get_functiondef(wrapper::regprocedure);
  if position('Browser task completion replay conflict' in body_)=0
    or position('Task was reconciled or cancelled; receipt not recorded' in body_)=0
    then raise exception '006: exact replay/cancellation guard absent'; end if;
end $$;
select 'PASS: 006 catalog-only receipt smoke; behavioral replay tests separate' as result;
rollback;
