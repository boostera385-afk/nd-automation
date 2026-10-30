-- Read/role-only hosted acceptance after the approved verified-access migration.
-- No fixture accounts, membership/email changes, jobs, sessions or customer writes.
begin;
select set_config('request.jwt.claim.sub',coalesce((
  select m.user_id::text from public.reporting_memberships m join auth.users u on u.id=m.user_id
    where u.email_confirmed_at is not null and m.role in ('owner','admin','operator')
    order by m.user_id limit 1),''),true);
set local role authenticated;
do $$ begin
  if not private_reporting.verified_human() then raise exception 'No verified staff fixture available; do not claim hosted positive acceptance'; end if;
  if not exists(select 1 from public.reporting_memberships) then raise exception 'Verified own membership read failed'; end if;
  if not exists(select 1 from public.reporting_organizations) then raise exception 'Verified business read failed'; end if;
  if exists(select 1 from public.reporting_organizations o where not private_reporting.is_member(o.id)) then
    raise exception 'Unexpected business read scope';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
  if private_reporting.verified_human() then raise exception 'Missing identity was accepted'; end if;
  if exists(select 1 from public.reporting_memberships) or exists(select 1 from public.reporting_customers)
    or exists(select 1 from public.reporting_notification_state) then raise exception 'Missing identity read was accepted'; end if;
  begin
    perform public.reporting_session_action('00000000-0000-0000-0000-000000000000'::uuid,'start','UTC');
    raise exception 'Missing identity mutation was accepted';
  exception when raise_exception then
    if sqlerrm<>'Not authorized' then raise; end if;
  end;
end $$;
reset role;

-- Check grants before assuming anon, which intentionally has no private-schema USAGE.
do $$ begin
  if has_function_privilege('anon','private_reporting.verified_human()','execute') then raise exception 'Anonymous helper grant'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.reporting_customers;
    raise exception 'Anonymous table read was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
select 'verified_access_hosted_read_role_smoke_pass' as result;
