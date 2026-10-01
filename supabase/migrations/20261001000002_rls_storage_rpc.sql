-- Row-level security, private storage, and queue RPCs.

-- ---------------------------------------------------------------------------
-- RLS: founder-only on every table. anon gets no table privileges at all.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'founders','rubric_versions','rubric_criteria','rubric_essential_requirements',
    'candidates','candidate_identities','candidate_profiles','evaluations','briefs',
    'email_drafts','decisions','email_sends','jobs','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- founders: nobody reads/writes through the API; is_founder() reads it as definer.
revoke all on public.founders from authenticated;

-- Full founder access (read + write) for working tables
do $$
declare t text;
begin
  foreach t in array array[
    'rubric_versions','rubric_criteria','rubric_essential_requirements',
    'candidates','candidate_identities','candidate_profiles','evaluations','briefs',
    'email_drafts','jobs'
  ] loop
    execute format($p$create policy founder_all on public.%I for all to authenticated
                     using (public.is_founder()) with check (public.is_founder())$p$, t);
  end loop;
end $$;

-- Decisions are append-only: founder can insert and read, never update/delete.
create policy founder_select on public.decisions for select to authenticated using (public.is_founder());
create policy founder_insert on public.decisions for insert to authenticated with check (public.is_founder());
revoke update, delete on public.decisions from authenticated;

-- Email send ledger: insert + status update; no delete.
create policy founder_select on public.email_sends for select to authenticated using (public.is_founder());
create policy founder_insert on public.email_sends for insert to authenticated with check (public.is_founder());
create policy founder_update on public.email_sends for update to authenticated using (public.is_founder()) with check (public.is_founder());
revoke delete on public.email_sends from authenticated;

-- Audit log: append-only.
create policy founder_select on public.audit_log for select to authenticated using (public.is_founder());
create policy founder_insert on public.audit_log for insert to authenticated with check (public.is_founder());
revoke update, delete on public.audit_log from authenticated;

-- ---------------------------------------------------------------------------
-- Private storage bucket for original CV files
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 10485760, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy cvs_founder_select on storage.objects for select to authenticated
  using (bucket_id = 'cvs' and public.is_founder());
create policy cvs_founder_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cvs' and public.is_founder());
create policy cvs_founder_update on storage.objects for update to authenticated
  using (bucket_id = 'cvs' and public.is_founder()) with check (bucket_id = 'cvs' and public.is_founder());
create policy cvs_founder_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cvs' and public.is_founder());

-- ---------------------------------------------------------------------------
-- Queue RPCs (security invoker => RLS still applies)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_job(
  p_kind text, p_candidate_id uuid, p_role text, p_payload jsonb, p_dedupe_key text, p_delay_seconds int default 0
) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare v_id bigint;
begin
  if not (public.is_founder() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'not authorised';
  end if;
  insert into public.jobs (kind, candidate_id, role, payload, dedupe_key, run_after)
  values (p_kind, p_candidate_id, p_role, coalesce(p_payload, '{}'::jsonb), p_dedupe_key,
          now() + make_interval(secs => greatest(p_delay_seconds, 0)))
  on conflict (dedupe_key) where status in ('queued','running') do nothing
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.claim_jobs(p_limit int, p_worker text)
returns setof public.jobs
language plpgsql security invoker set search_path = '' as $$
begin
  if not (public.is_founder() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'not authorised';
  end if;

  -- Recover jobs whose worker died (e.g. a serverless timeout) so processing is resumable.
  update public.jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         last_error = coalesce(last_error, 'worker timed out; re-queued'),
         locked_at = null, locked_by = null
   where status = 'running' and locked_at < now() - interval '5 minutes';

  return query
  with picked as (
    select j.id from public.jobs j
     where j.status = 'queued' and j.run_after <= now()
     order by case j.kind when 'rank' then 0 when 'score' then 1 when 'extract' then 2
                          when 'brief' then 3 else 4 end, j.id
     limit greatest(1, least(p_limit, 5))
     for update skip locked
  )
  update public.jobs j
     set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
    from picked where j.id = picked.id
  returning j.*;
end; $$;

revoke all on function public.enqueue_job(text, uuid, text, jsonb, text, int) from public, anon;
revoke all on function public.claim_jobs(int, text) from public, anon;
grant execute on function public.enqueue_job(text, uuid, text, jsonb, text, int) to authenticated, service_role;
grant execute on function public.claim_jobs(int, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Founder allowlist seed (the only account that can use the app)
-- ---------------------------------------------------------------------------
insert into public.founders (email, full_name)
values ('karan_kulkarni@pg27.mesaschool.co', 'Founder account (MESA test operator)')
on conflict (email) do nothing;
