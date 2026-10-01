import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./rubric/types";
import type { CriterionResult, EssentialResult } from "./scoring/engine";

export type EvaluationRow = {
  id: string;
  candidate_id: string;
  role: Role;
  rubric_version_id: string;
  stage: string;
  model: string;
  criterion_scores: CriterionResult[];
  coverage_pct: number;
  score: number | null;
  essential_requirements: EssentialResult[];
  recommendation: string;
  recommendation_reasons: { applicable: string[]; reasons: string[]; display: string; interpretable: boolean };
  strongest_evidence: string | null;
  missing_evidence: string | null;
  contradictions: { description: string; quotes: string[] }[];
  rule_enforcement_log: { code: string; rule: string; change: string }[];
  created_at: string;
};

export type CandidateRow = {
  id: string;
  /** Role the candidate is ranked in: assigned automatically from both scores unless the founder set it. Null until assigned. */
  applied_role: Role | null;
  role_source: "auto" | "founder";
  role_fit: RoleFitStored | null;
  status: string;
  original_filename: string;
  file_mime: string | null;
  file_size: number | null;
  is_synthetic: boolean;
  last_error: string | null;
  applied_rank: number | null;
  rank_tier: "interpretable" | "low_coverage" | "not_scorable" | null;
  in_top5: boolean;
  duplicate_of: string | null;
  possible_duplicate_of: string | null;
  created_at: string;
};

export type RoleFitStored = {
  role: Role | null;
  basis: "score" | "coverage" | "only_scorable" | "none";
  confidence: "comparable" | "low" | "none";
  closeCall: boolean;
  reason: string;
  pm: { score: number | null; coveragePct: number } | null;
  spm: { score: number | null; coveragePct: number } | null;
  rubric_version_id?: string;
  computed_at?: string;
};

export type DecisionRow = { id: string; candidate_id: string; decision: "advance" | "hold" | "decline"; rationale: string; decided_by_email: string; decided_at: string };

export async function latestDecisions(sb: SupabaseClient, ids?: string[]): Promise<Map<string, DecisionRow>> {
  let q = sb.from("decisions").select("id, candidate_id, decision, rationale, decided_by_email, decided_at").order("decided_at", { ascending: false });
  if (ids) q = q.in("candidate_id", ids);
  const { data } = await q;
  const m = new Map<string, DecisionRow>();
  for (const d of (data ?? []) as DecisionRow[]) if (!m.has(d.candidate_id)) m.set(d.candidate_id, d);
  return m;
}

export async function dashboardData(sb: SupabaseClient) {
  const [{ data: cands }, { data: active }] = await Promise.all([
    sb.from("candidates").select("id, applied_role, role_source, role_fit, status, original_filename, is_synthetic, last_error, applied_rank, rank_tier, in_top5, created_at, duplicate_of, possible_duplicate_of, file_mime, file_size").order("created_at"),
    sb.from("rubric_versions").select("id, version_label, declared_status, validation").eq("is_active", true).maybeSingle(),
  ]);
  const candidates = (cands ?? []) as CandidateRow[];
  const ids = candidates.map((c) => c.id);
  const [{ data: evs }, { data: idents }, { data: sends }, { data: briefs }, decisions] = await Promise.all([
    sb.from("evaluations").select("candidate_id, role, score, coverage_pct, recommendation, rubric_version_id, recommendation_reasons").eq("is_current", true).in("candidate_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    sb.from("candidate_identities").select("candidate_id, full_name").in("candidate_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    sb.from("email_sends").select("candidate_id, status, mode"),
    sb.from("briefs").select("candidate_id, role, sentences").eq("is_current", true),
    latestDecisions(sb),
  ]);
  const evMap = new Map<string, { PM?: EvalLite; SPM?: EvalLite }>();
  for (const e of (evs ?? []) as EvalLite[]) {
    const cur = evMap.get(e.candidate_id) ?? {};
    cur[e.role] = e;
    evMap.set(e.candidate_id, cur);
  }
  const names = new Map((idents ?? []).map((i) => [i.candidate_id, i.full_name as string | null]));
  const sentMap = new Map<string, { status: string; mode: string }[]>();
  for (const s of sends ?? []) sentMap.set(s.candidate_id, [...(sentMap.get(s.candidate_id) ?? []), s]);
  const briefMap = new Map((briefs ?? []).map((b) => [`${b.candidate_id}:${b.role}`, b.sentences as string[]]));

  const rows = candidates.map((c) => ({
    ...c,
    name: names.get(c.id) ?? null,
    evals: evMap.get(c.id) ?? {},
    decision: decisions.get(c.id) ?? null,
    sends: sentMap.get(c.id) ?? [],
    brief: briefMap.get(`${c.id}:${c.applied_role}`) ?? null,
  }));
  const live = rows.filter((r) => r.status !== "duplicate");
  const counts = {
    total: live.length,
    byRole: { PM: live.filter((r) => r.applied_role === "PM").length, SPM: live.filter((r) => r.applied_role === "SPM").length, none: live.filter((r) => !r.applied_role).length },
    scored: live.filter((r) => r.status === "scored").length,
    processing: live.filter((r) => ["queued", "extracting", "extracted", "scoring"].includes(r.status)).length,
    attention: live.filter((r) => ["needs_attention", "failed"].includes(r.status)).length,
    awaitingUpload: live.filter((r) => r.status === "awaiting_upload").length,
    duplicates: rows.length - live.length,
    pendingDecisions: live.filter((r) => r.status === "scored" && !r.decision).length,
    decided: live.filter((r) => r.decision).length,
    emailsSent: (sends ?? []).filter((s) => s.status === "sent").length,
  };
  const ranked = (role: Role) =>
    live
      .filter((r) => r.applied_role === role && r.applied_rank !== null)
      .sort((a, b) => (a.applied_rank ?? 999) - (b.applied_rank ?? 999));
  return { rows: live, counts, ranked: { PM: ranked("PM"), SPM: ranked("SPM") }, activeRubric: active };
}

export type EvalLite = {
  candidate_id: string;
  role: Role;
  score: number | null;
  coverage_pct: number;
  recommendation: string;
  rubric_version_id: string;
  recommendation_reasons: { display?: string; interpretable?: boolean } | null;
};

export async function candidateDetail(sb: SupabaseClient, id: string) {
  const { data: cand } = await sb.from("candidates").select("*").eq("id", id).maybeSingle();
  if (!cand) return null;
  const [{ data: ident }, { data: prof }, { data: evs }, { data: briefs }, { data: drafts }, { data: decisions }, { data: sends }, { data: jobs }] = await Promise.all([
    sb.from("candidate_identities").select("*").eq("candidate_id", id).maybeSingle(),
    sb.from("candidate_profiles").select("*").eq("candidate_id", id).maybeSingle(),
    sb.from("evaluations").select("*").eq("candidate_id", id).eq("is_current", true),
    sb.from("briefs").select("*").eq("candidate_id", id).eq("is_current", true),
    sb.from("email_drafts").select("*").eq("candidate_id", id).eq("is_current", true),
    sb.from("decisions").select("*").eq("candidate_id", id).order("decided_at", { ascending: false }),
    sb.from("email_sends").select("*").eq("candidate_id", id).order("confirmed_at", { ascending: false }),
    sb.from("jobs").select("id, kind, role, status, attempts, last_error, run_after, updated_at").eq("candidate_id", id).order("id", { ascending: false }).limit(20),
  ]);
  const rubricIds = Array.from(new Set((evs ?? []).map((e) => e.rubric_version_id)));
  const { data: rubrics } = rubricIds.length
    ? await sb.from("rubric_versions").select("id, version_label, declared_status, is_active").in("id", rubricIds)
    : { data: [] };
  const evalByRole = Object.fromEntries((evs ?? []).map((e) => [e.role, e])) as Partial<Record<Role, EvaluationRow>>;
  return {
    cand: cand as CandidateRow & { file_path: string | null },
    ident,
    prof,
    evalByRole,
    briefs: Object.fromEntries((briefs ?? []).map((b) => [b.role, b])) as Partial<Record<Role, { sentences: string[]; interview_questions: { criterion_code: string; question: string; why: string; source: string }[]; model: string; created_at: string; evaluation_id: string }>>,
    drafts: (drafts ?? []) as DraftRow[],
    decisions: (decisions ?? []) as DecisionRow[],
    sends: sends ?? [],
    jobs: jobs ?? [],
    rubrics: rubrics ?? [],
  };
}

export type DraftRow = {
  id: string;
  candidate_id: string;
  kind: "invite" | "rejection";
  subject_template: string;
  body_template: string;
  version: number;
  origin: "ai" | "founder_edited";
  model: string | null;
  suggested_by_rank: boolean;
  updated_at: string;
};
