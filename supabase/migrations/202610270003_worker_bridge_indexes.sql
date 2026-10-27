-- Cover tenant-scoped foreign keys identified by the hosted performance advisor.
create index reporting_worker_profile_worker_fk on public.reporting_worker_profiles(organization_id, worker_id);
create index reporting_worker_profile_session_fk on public.reporting_worker_profiles(organization_id, monitoring_session_id);
create index reporting_job_worker_fk on public.reporting_check_jobs(organization_id, worker_id);
create index reporting_job_binding_fk on public.reporting_check_jobs(organization_id, binding_id);
create index reporting_job_publication_fk on public.reporting_check_jobs(organization_id, publication_id);
create index reporting_job_session_fk on public.reporting_check_jobs(organization_id, session_id);

comment on table private_reporting.worker_credentials is 'Private hashed worker credentials. RLS intentionally has no client policies; all client table privileges are revoked. Narrow worker RPCs validate the credential under SECURITY DEFINER.';
comment on table public.reporting_work_sessions is 'Human work sessions. Explicitly authorized monitoring jobs may be claimed only while the approving session is active and younger than ten hours; session buttons alone do not enable publishing or account creation.';
comment on table public.reporting_observations is 'Sourced manual or automatic read-only observations. A saved observation is not a guarantee of current platform visibility.';
comment on table public.reporting_post_checks is 'Append-only sourced manual/automatic results. Token-authenticated monitoring completion may write auto_check results; technical failures never change post visibility and automatic confirmed removal is disabled.';
comment on function public.reporting_worker_heartbeat(text) is 'Intentionally exposed to anon transport; requires a valid scoped revocable worker bearer credential. No direct table privileges are granted.';
comment on function public.reporting_claim_check(text) is 'Intentionally exposed to anon transport; validates the worker bearer credential, organization/profile binding, active approving session and exclusive job lease. No publishing or arbitrary-code jobs.';
comment on function public.reporting_complete_check(text,uuid,uuid,jsonb) is 'Intentionally exposed to anon transport; validates worker credential, job ownership, lease and bounded result. Atomic and replay-idempotent; no cross-worker or direct table writes.';
