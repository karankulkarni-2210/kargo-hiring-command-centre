-- Kargo Hiring Command Centre — core schema
-- Every table is protected by row-level security. Only an authenticated user whose
-- email is on public.founders can read or write anything. The anon role gets nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Founder allowlist + helper
-- ---------------------------------------------------------------------------
create table public.founders (
  email      text primary key check (email = lower(email)),
  full_name  text,
  created_at timestamptz not null default now()
);

create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.founders f
    where f.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_founder() from public, anon;
grant execute on function public.is_founder() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rubric (original source + parsed, versioned)
-- ---------------------------------------------------------------------------
create table public.rubric_versions (
  id               uuid primary key default gen_random_uuid(),
  version_label    text not null,
  source_filename  text not null,
  source_text      text not null,                 -- original file, verbatim
  source_sha256    text not null,
  parse_method     text not null check (parse_method in ('rubix_text','json','ai_assisted')),
  declared_status  text not null,                 -- status as declared by the source, e.g. PROVISIONAL
  parsed           jsonb not null,                -- full structured rubric
  validation       jsonb not null,                -- weight checks, warnings, assignment-fit flags
  is_active        boolean not null default false,
  imported_at      timestamptz not null default now(),
  imported_by      text,
  activated_at     timestamptz,
  notes            text
);
create unique index rubric_versions_one_active on public.rubric_versions (is_active) where is_active;
create unique index rubric_versions_sha on public.rubric_versions (source_sha256, parse_method);

create table public.rubric_criteria (
  id                          uuid primary key default gen_random_uuid(),
  rubric_version_id           uuid not null references public.rubric_versions(id) on delete cascade,
  role                        text not null check (role in ('PM','SPM')),
  criterion_code              text not null,
  name                        text not null,
  weight                      numeric(6,2) not null check (weight > 0 and weight <= 100),
  evidence_mode               text not null check (evidence_mode in ('CV-OK','CV-PARTIAL','INTERVIEW/WORK-SAMPLE ONLY')),
  expected_outcome            text,
  basis                       text,
  anchors                     jsonb not null,     -- {"1": "...", ..., "5": "..."}
  acceptable_evidence         text,
  interview_probe             text,
  hypothesis_refs             text[] not null default '{}',
  historical_supporting_cases int not null default 0,
  historical_relevant_cases   int not null default 0,
  pattern_confidence          text not null default 'Not established',
  sort_order                  int not null,
  unique (rubric_version_id, criterion_code)
);

create table public.rubric_essential_requirements (
  id                  uuid primary key default gen_random_uuid(),
  rubric_version_id   uuid not null references public.rubric_versions(id) on delete cascade,
  role                text not null check (role in ('PM','SPM')),
  code                text not null,
  requirement         text not null,
  source              text,
  status_rule         text not null,
  essentiality_confirmed boolean not null default false,
  sort_order          int not null,
  unique (rubric_version_id, code)
);

-- ---------------------------------------------------------------------------
-- Candidates. Personal identifiers live ONLY in candidate_identities.
-- ---------------------------------------------------------------------------
create table public.candidates (
  id                uuid primary key default gen_random_uuid(),
  applied_role      text not null check (applied_role in ('PM','SPM')),
  status            text not null default 'awaiting_upload'
                    check (status in ('awaiting_upload','queued','extracting','extracted','scoring','scored','needs_attention','failed','duplicate')),
  original_filename text not null,
  file_path         text,
  file_mime         text,
  file_size         bigint,
  file_sha256       text not null,
  duplicate_of      uuid references public.candidates(id) on delete set null,
  possible_duplicate_of uuid references public.candidates(id) on delete set null,
  is_synthetic      boolean not null default false,
  last_error        text,
  applied_rank      int,
  rank_tier         text check (rank_tier in ('interpretable','low_coverage','not_scorable')),
  in_top5           boolean not null default false,
  ranked_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index candidates_unique_file on public.candidates (file_sha256) where status <> 'duplicate';
create index candidates_role_rank on public.candidates (applied_role, applied_rank);

create table public.candidate_identities (           -- RESTRICTED: never sent to scoring/brief/draft AI calls
  candidate_id         uuid primary key references public.candidates(id) on delete cascade,
  full_name            text,
  first_name           text,
  email                text,
  phone                text,
  location_text        text,
  relocation_statement text,
  profile_links        text[] not null default '{}',
  extracted_at         timestamptz not null default now()
);

create table public.candidate_profiles (             -- redacted professional evidence only
  candidate_id      uuid primary key references public.candidates(id) on delete cascade,
  redacted_text     text not null,
  structured        jsonb not null default '{}'::jsonb,
  location_signal   text not null default 'not_stated' check (location_signal in ('mumbai','outside_mumbai','not_stated')),
  relocation_signal text not null default 'not_stated' check (relocation_signal in ('willing','unwilling','not_stated')),
  extraction_path   text not null check (extraction_path in ('text_layer','docx','plain_text','gemini_ocr')),
  extraction_model  text,
  document_quality  text not null default 'ok' check (document_quality in ('ok','partial','unreadable')),
  injection_flags   text[] not null default '{}',
  redaction_report  jsonb not null default '{}'::jsonb,
  char_count        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI recommendation layer (evaluations, briefs, drafts)
-- ---------------------------------------------------------------------------
create table public.evaluations (
  id                    uuid primary key default gen_random_uuid(),
  candidate_id          uuid not null references public.candidates(id) on delete cascade,
  role                  text not null check (role in ('PM','SPM')),
  rubric_version_id     uuid not null references public.rubric_versions(id),
  stage                 text not null default 'CV screen',
  model                 text not null,
  criterion_scores      jsonb not null,           -- validated, rule-enforced per-criterion results
  coverage_pct          numeric(5,2) not null,
  score                 numeric(5,1),             -- null => Not scorable
  essential_requirements jsonb not null,
  recommendation        text not null,
  recommendation_reasons jsonb not null default '[]'::jsonb,
  strongest_evidence    text,
  missing_evidence      text,
  contradictions        jsonb not null default '[]'::jsonb,
  rule_enforcement_log  jsonb not null default '[]'::jsonb,
  is_current            boolean not null default true,
  created_at            timestamptz not null default now()
);
create unique index evaluations_current on public.evaluations (candidate_id, role) where is_current;

create table public.briefs (
  id                  uuid primary key default gen_random_uuid(),
  candidate_id        uuid not null references public.candidates(id) on delete cascade,
  role                text not null check (role in ('PM','SPM')),
  evaluation_id       uuid not null references public.evaluations(id) on delete cascade,
  rubric_version_id   uuid not null references public.rubric_versions(id),
  sentences           text[] not null check (array_length(sentences, 1) = 3),
  interview_questions jsonb not null,
  model               text not null,
  is_current          boolean not null default true,
  created_at          timestamptz not null default now()
);
create unique index briefs_current on public.briefs (candidate_id, role) where is_current;

create table public.email_drafts (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references public.candidates(id) on delete cascade,
  kind               text not null check (kind in ('invite','rejection')),
  subject_template   text not null,
  body_template      text not null,
  version            int not null default 1,
  origin             text not null check (origin in ('ai','founder_edited')),
  model              text,
  suggested_by_rank  boolean not null default false,  -- shortlist position suggested this type; NOT a decision
  is_current         boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index email_drafts_current on public.email_drafts (candidate_id, kind) where is_current;

-- ---------------------------------------------------------------------------
-- Human decision layer (kept separate from AI output; append-only)
-- ---------------------------------------------------------------------------
create table public.decisions (
  id                     uuid primary key default gen_random_uuid(),
  candidate_id           uuid not null references public.candidates(id) on delete cascade,
  decision               text not null check (decision in ('advance','hold','decline')),
  rationale              text not null check (length(trim(rationale)) >= 10),
  decided_by_email       text not null,
  decided_at             timestamptz not null default now(),
  ai_recommendation_snapshot jsonb not null,      -- what the system said at the time, for audit
  rubric_version_id      uuid references public.rubric_versions(id)
);
create index decisions_candidate on public.decisions (candidate_id, decided_at desc);

create table public.email_sends (
  id                  uuid primary key default gen_random_uuid(),
  candidate_id        uuid not null references public.candidates(id) on delete cascade,
  draft_id            uuid not null references public.email_drafts(id),
  draft_version       int not null,
  decision_id         uuid not null references public.decisions(id),
  kind                text not null check (kind in ('invite','rejection')),
  mode                text not null check (mode in ('test','live')),
  to_email            text not null,
  intended_recipient_email text,
  subject_rendered    text not null,
  status              text not null check (status in ('sending','sent','failed')),
  provider            text not null default 'resend',
  provider_message_id text,
  error               text,
  confirmed_by_email  text not null,
  confirmed_at        timestamptz not null default now(),
  completed_at        timestamptz
);
-- Duplicate-send guards (failed attempts do not block a retry)
create unique index email_sends_no_dup_live on public.email_sends (candidate_id, kind)
  where mode = 'live' and status in ('sending','sent');
create unique index email_sends_no_dup_test on public.email_sends (draft_id, draft_version)
  where mode = 'test' and status in ('sending','sent');

-- ---------------------------------------------------------------------------
-- Resumable job queue
-- ---------------------------------------------------------------------------
create table public.jobs (
  id           bigserial primary key,
  kind         text not null check (kind in ('extract','score','rank','brief','draft')),
  candidate_id uuid references public.candidates(id) on delete cascade,
  role         text check (role in ('PM','SPM')),
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  attempts     int not null default 0,
  max_attempts int not null default 5,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  dedupe_key   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index jobs_dedupe_open on public.jobs (dedupe_key) where status in ('queued','running');
create index jobs_ready on public.jobs (status, run_after);

create table public.audit_log (
  id         bigserial primary key,
  actor      text not null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create trigger candidates_touch before update on public.candidates for each row execute function public.touch_updated_at();
create trigger profiles_touch   before update on public.candidate_profiles for each row execute function public.touch_updated_at();
create trigger drafts_touch     before update on public.email_drafts for each row execute function public.touch_updated_at();
create trigger jobs_touch       before update on public.jobs for each row execute function public.touch_updated_at();
