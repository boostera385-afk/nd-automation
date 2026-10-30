-- Store the author label the worker now collects and record completion honestly.
--
-- Previously every automatic comment was saved as 'Author not collected' and every
-- observation claimed comments_complete = false, because the worker could not read
-- comments at all. It now can (22/22 validated on a live thread), so:
--   * a comment object may carry an optional `author` (null or 1-200 chars);
--   * the result may carry `comments_total` and `comments_complete`, both optional so
--     an older worker keeps working;
--   * completion is only accepted when it matches the number of comments supplied;
--   * the observation and the publication record the total, and the notification says
--     which of the two actually happened instead of always claiming "partial".
--
-- Same signature, security definer and lease checks as 20261030220000.
create or replace function public.reporting_complete_check(credential text, job uuid, lease uuid, result jsonb)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare w public.reporting_workers; j public.reporting_check_jobs; code text; notes text; fingerprint text;
  info record; obs uuid; checked timestamptz; item jsonb; total integer; complete boolean;
begin
  w := private_reporting.worker_for_token(credential);
  perform 1 from public.reporting_workers where id=w.id and enabled for update;
  if not found then raise exception 'Worker unavailable'; end if;
  select * into j from public.reporting_check_jobs where id=job and worker_id=w.id for update;
  if j.id is null or j.lease_token is distinct from lease then raise exception 'Invalid lease'; end if;
  if j.status='completed' then return false; end if;
  if j.status<>'leased' or j.lease_expires_at <= clock_timestamp() then raise exception 'Expired or inactive lease'; end if;
  if result is null or jsonb_typeof(result)<>'object' or not (result ?& array['outcome','reason','adapter_sha256','comments','observed_at'])
    or exists(select 1 from jsonb_object_keys(result) k
              where k not in ('outcome','reason','adapter_sha256','comments','observed_at','comments_total','comments_complete'))
    then raise exception 'Invalid result'; end if;
  code:=result->>'outcome'; notes:=result->>'reason'; fingerprint:=result->>'adapter_sha256';
  -- Automatic removal confirmation is deliberately disabled pending validated evidence rules.
  if jsonb_typeof(result->'outcome')<>'string' or jsonb_typeof(result->'reason')<>'string' or jsonb_typeof(result->'adapter_sha256')<>'string'
    or code is null or code not in ('alive','unavailable','proxy_issue','login_required','verification_required','network_error','profile_error','needs_review')
    or notes is null or char_length(trim(notes)) not between 1 and 2000 or fingerprint is null or fingerprint !~ '^[a-f0-9]{64}$'
    then raise exception 'Invalid result fields'; end if;
  if jsonb_typeof(result->'comments')<>'array' or jsonb_array_length(result->'comments')>200 then raise exception 'Invalid comments'; end if;
  if code<>'alive' and jsonb_array_length(result->'comments')>0 then raise exception 'Comments require an exact visible post'; end if;
  if result ? 'comments_total' and jsonb_typeof(result->'comments_total')<>'null' then
    if jsonb_typeof(result->'comments_total')<>'number' or (result->>'comments_total') !~ '^[0-9]{1,8}$' then
      raise exception 'Invalid comment total';
    end if;
    total := (result->>'comments_total')::integer;
  end if;
  if result ? 'comments_complete' and jsonb_typeof(result->'comments_complete')<>'boolean' then
    raise exception 'Invalid completion flag';
  end if;
  complete := coalesce((result->>'comments_complete')::boolean, false);
  if complete and (total is null or total <> jsonb_array_length(result->'comments')) then
    raise exception 'A complete collection must match the reported total';
  end if;
  if code<>'alive' and (total is not null or complete) then raise exception 'Comment totals require an exact visible post'; end if;
  for item in select value from jsonb_array_elements(result->'comments') loop
    if jsonb_typeof(item)<>'object' or not (item ?& array['external_id','body'])
      or exists(select 1 from jsonb_object_keys(item) k where k not in ('external_id','body','author'))
      or jsonb_typeof(item->'external_id')<>'string' or jsonb_typeof(item->'body')<>'string'
      or char_length(trim(item->>'external_id')) not between 1 and 200 or char_length(trim(item->>'body')) not between 1 and 5000
      then raise exception 'Invalid comment'; end if;
    if item ? 'author' and jsonb_typeof(item->'author') not in ('null','string') then raise exception 'Invalid comment author'; end if;
    if jsonb_typeof(item->'author')='string' and char_length(trim(item->>'author')) not between 1 and 200 then
      raise exception 'Invalid comment author';
    end if;
  end loop;
  if jsonb_typeof(result->'observed_at')<>'string' then raise exception 'Invalid observation time'; end if;
  checked := (result->>'observed_at')::timestamptz;
  if checked is null or not isfinite(checked) or checked<j.leased_at-interval '1 minute' or checked>clock_timestamp()+interval '5 minutes' then raise exception 'Observation time outside the lease window'; end if;
  perform 1 from public.reporting_publications where id=j.publication_id and organization_id=j.organization_id for update;
  select * into info from private_reporting.check_outcome_info(code);
  if info.new_visibility is not null then
    insert into public.reporting_observations(organization_id,publication_id,visibility,observed_at,source,comments_total,comments_complete,notes,created_by)
      values(j.organization_id,j.publication_id,info.new_visibility,checked,'auto_check',total,complete,notes,null) returning id into obs;
    update public.reporting_publications set visibility=info.new_visibility,last_observed_at=checked,
      comments_total=case when total is null then comments_total else total end
      where id=j.publication_id and (last_observed_at is null or last_observed_at<=checked);
  end if;
  update public.reporting_publications set last_check_outcome=code,last_checked_at=checked where id=j.publication_id and (last_checked_at is null or last_checked_at<=checked);
  insert into public.reporting_post_checks(organization_id,publication_id,outcome,tone,message,notes,source,checked_at,observation_id,created_by)
    values(j.organization_id,j.publication_id,code,info.tone,info.headline,notes,'auto_check',checked,obs,null);
  for item in select value from jsonb_array_elements(result->'comments') loop
    insert into public.reporting_comments(organization_id,publication_id,source_comment_id,author_label,body,created_by,source,first_observed_at)
      values(j.organization_id,j.publication_id,item->>'external_id',
             coalesce(nullif(trim(coalesce(item->>'author','')),''),'Author not collected'),
             item->>'body',null,'auto_check',checked)
      on conflict do nothing;
  end loop;
  insert into public.reporting_notifications(organization_id,publication_id,kind,tone,title,message)
    values(j.organization_id,j.publication_id,'check_result',info.tone,info.headline,
      case when complete then 'Automatic read-only check completed; all '||total||' comments captured.'
           else 'Automatic read-only check completed; comment collection is partial.' end);
  update public.reporting_check_jobs set status='completed',completed_at=clock_timestamp(),outcome=code,adapter_sha256=fingerprint where id=j.id;
  return true;
end $function$;
