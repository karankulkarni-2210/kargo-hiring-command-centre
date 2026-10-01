-- Automatic role fit.
-- `applied_role` now means "the role this candidate is ranked in". It is assigned automatically
-- from both rubric evaluations (see suggestRole in src/lib/scoring/engine.ts) and can be overridden
-- by the founder. It is NULL until both roles are scored, or when neither role is scorable.
alter table public.candidates alter column applied_role drop not null;

alter table public.candidates
  add column role_source      text not null default 'auto' check (role_source in ('auto','founder')),
  add column role_fit         jsonb,
  add column role_assigned_at timestamptz;

comment on column public.candidates.applied_role is 'Role the candidate is ranked in. Auto-assigned from role_fit unless role_source = founder.';
comment on column public.candidates.role_fit is 'Latest automatic fit result (role, basis, confidence, reason, both scores). Kept even when the founder overrides.';

-- Candidates who already have a recorded decision keep the role that decision was made in.
update public.candidates c
   set role_source = 'founder', role_assigned_at = now()
 where exists (select 1 from public.decisions d where d.candidate_id = c.id);
