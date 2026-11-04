-- Self-healing expired leases for checks and automation tasks (additive replacement).
--
-- SUPERSEDED same day by 20261105203000_expired_lease_self_heal_v2.sql: v1
-- allowed a fresh claim in the same call, which crossed the existing "no
-- automatic retry of expired claims" acceptance contract. v2 releases the
-- expired lease and returns null; the next poll plans fresh due work. Use v2.
-- This file is kept as the applied at-history record of the first attempt.
-- Before this change, one crashed run pinned the laptop's queue: every claim
-- returned null until a person clicked "Reconcile expired lease" on the
-- dashboard. A lease that is past `lease_expires_at` carries no recoverable
-- check/task result by design, so releasing it automatically matches the
-- manual function's semantics exactly (cancel + clear token). A late result
-- from the old lease is still rejected, the same as after manual
-- reconciliation: no result is fabricated or discarded silently.
--
-- Publish leases stay manual on purpose: an expired submit may have reached
-- the platform, so it completes as `needs_reconciliation` and always requires
-- an operator to acknowledge the ambiguity.

create or replace function public.reporting_claim_check(credential text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare w public.reporting_workers; j public.reporting_check_jobs; post_url text; post_title text; post_label text;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at=clock_timestamp() where id=w.id;
  -- Release this worker's expired check/task leases before the one-browser
  -- check below, or a crashed run pins the queue until someone clicks the
  -- dashboard button. Same state the manual reconciliation functions write.
  update public.reporting_check_jobs set status='cancelled', lease_token=null
    where worker_id=w.id and status='leased' and lease_expires_at<clock_timestamp();
  update public.reporting_automation_tasks set status='cancelled', lease_token=null,
        completed_at=clock_timestamp(), error='Expired lease released at the next claim'
    where worker_id=w.id and status='leased' and lease_expires_at<clock_timestamp();
  -- One browser operation at a time per worker, across every job family.
  if exists(select 1 from public.reporting_check_jobs where worker_id=w.id and status='leased')
     or exists(select 1 from public.reporting_publish_jobs where worker_id=w.id and status='leased')
     or exists(select 1 from public.reporting_automation_tasks where worker_id=w.id and status='leased') then return null; end if;
  update public.reporting_check_jobs q set status='cancelled' where q.worker_id=w.id and q.status='pending' and exists(
    select 1 from public.reporting_work_sessions s where s.id=q.session_id and (s.status='closed' or s.started_at<=clock_timestamp()-interval '10 hours'));
  insert into public.reporting_check_jobs(organization_id,worker_id,binding_id,publication_id,session_id,profile_id)
    select b.organization_id,b.worker_id,b.id,p.id,s.id,b.profile_id
    from public.reporting_worker_profiles b
    join public.reporting_work_sessions s on s.id=b.monitoring_session_id and s.organization_id=b.organization_id
    join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
    join public.reporting_publications p on p.organization_id=b.organization_id and p.customer_id=b.customer_id and p.account_label=b.account_label
    join public.reporting_customers c on c.id=b.customer_id and c.organization_id=b.organization_id
    where b.worker_id=w.id and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')
      and (
        p.last_checked_at is null
        or p.last_checked_at<clock_timestamp()-interval '24 hours'
        or (p.last_check_outcome in ('proxy_issue','network_error','profile_error')
            and p.last_checked_at<clock_timestamp()-interval '30 minutes'
            and (select count(*) from public.reporting_post_checks x where x.publication_id=p.id
                   and x.checked_at>clock_timestamp()-interval '24 hours') < 6)
      )
      and (p.published_at is null or (p.published_at at time zone c.time_zone)::date < (clock_timestamp() at time zone c.time_zone)::date)
      and p.url ~ '^https://(www[.])?nextdoor[.]com/(p|for_sale_and_free)/[A-Za-z0-9_-]+$'
      and not exists(select 1 from public.reporting_check_jobs q where q.publication_id=p.id and q.status in ('pending','leased'))
    order by p.created_at,p.id limit 100 on conflict do nothing;
  select q.* into j from public.reporting_check_jobs q
    join public.reporting_work_sessions s on s.id=q.session_id and s.organization_id=q.organization_id
    join public.reporting_memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
    where q.worker_id=w.id and q.status='pending' and s.status='active' and s.started_at>clock_timestamp()-interval '10 hours' and m.role in ('owner','admin','operator')
    order by q.created_at,q.id for update of q skip locked limit 1;
  if j.id is null then return null; end if;
  update public.reporting_check_jobs set status='leased',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '10 minutes'
    where id=j.id returning * into j;
  select url, title, account_label into post_url, post_title, post_label from public.reporting_publications where id=j.publication_id and organization_id=j.organization_id;
  return jsonb_build_object('job_id',j.id,'publication_id',j.publication_id,'profile_id',j.profile_id,'url',post_url,
    'lease_token',j.lease_token,'lease_expires_at',j.lease_expires_at,'title',post_title,'account_label',post_label);
end $function$;

create or replace function public.reporting_claim_automation_task(credential text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare w public.reporting_workers; t public.reporting_automation_tasks;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id = w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  update public.reporting_workers set last_seen_at = clock_timestamp() where id = w.id;
  -- Same self-healing rule as the check claim: expired leases never carry a
  -- recoverable task result and must not pin the queue.
  update public.reporting_check_jobs set status='cancelled', lease_token=null
    where worker_id=w.id and status='leased' and lease_expires_at<clock_timestamp();
  update public.reporting_automation_tasks set status='cancelled', lease_token=null,
        completed_at=clock_timestamp(), error='Expired lease released at the next claim'
    where worker_id=w.id and status='leased' and lease_expires_at<clock_timestamp();
  -- One browser operation at a time per laptop, across every job family.
  if exists(select 1 from public.reporting_check_jobs where worker_id = w.id and status = 'leased')
    or exists(select 1 from public.reporting_publish_jobs where worker_id = w.id and status = 'leased')
    or exists(select 1 from public.reporting_automation_tasks where worker_id = w.id and status = 'leased')
    then return null; end if;
  select q.* into t from public.reporting_automation_tasks q
    where q.worker_id = w.id and q.status = 'pending'
    order by q.created_at, q.id for update of q skip locked limit 1;
  if t.id is null then return null; end if;
  update public.reporting_automation_tasks set status = 'leased', lease_token = gen_random_uuid(),
    leased_at = clock_timestamp(), lease_expires_at = clock_timestamp() + interval '10 minutes'
    where id = t.id returning * into t;
  return jsonb_build_object('task_id', t.id, 'kind', t.kind, 'payload', t.payload,
    'lease_token', t.lease_token, 'lease_expires_at', t.lease_expires_at);
end $$;
