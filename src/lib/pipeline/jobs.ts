import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiBrief, aiDraft, aiExtract, aiScore } from "../ai/tasks";
import { GeminiConfigError, GeminiError, GeminiMalformedError, GeminiRateLimitError } from "../ai/gemini";
import { assertRedacted, cleanPersonName, detectInjection, firstNameOf, preRedactContacts, redactIdentity, residualIdentifierCheck, samePerson } from "../redaction";
import { loadActiveRubric, sha256Hex, type ActiveRubric } from "../rubric/store";
import { ROLES, type Role } from "../rubric/types";
import {
  computeScore,
  enforceCriterionRules,
  enforceEssentials,
  normaliseForMatch,
  quoteAppearsIn,
  rankWithinRole,
  recommend,
  suggestRole,
  type CriterionResult,
  type EssentialResult,
  type RoleFit,
} from "../scoring/engine";
import { validateTemplate } from "../email/core";
import { detectKind, docxText, meaningfulChars, pdfText, txtText } from "./text";

export class PermanentJobError extends Error {}

export type Job = {
  id: number;
  kind: "extract" | "score" | "rank" | "brief" | "draft";
  candidate_id: string | null;
  role: Role | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

const STAGE = "CV screen";

export async function enqueue(
  sb: SupabaseClient,
  kind: Job["kind"],
  candidateId: string | null,
  role: Role | null,
  dedupeKey: string,
  payload: Record<string, unknown> = {},
  delaySeconds = 0,
) {
  const { error } = await sb.rpc("enqueue_job", {
    p_kind: kind,
    p_candidate_id: candidateId,
    p_role: role,
    p_payload: payload,
    p_dedupe_key: dedupeKey,
    p_delay_seconds: delaySeconds,
  });
  if (error) throw new Error(`enqueue ${kind}: ${error.message}`);
}

async function setCandidate(sb: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await sb.from("candidates").update(patch).eq("id", id);
  if (error) throw new Error(`update candidate: ${error.message}`);
}

async function audit(sb: SupabaseClient, actor: string, action: string, entity: string, entityId: string | null, details: Record<string, unknown> = {}) {
  await sb.from("audit_log").insert({ actor, action, entity, entity_id: entityId, details });
}

async function requireRubric(sb: SupabaseClient): Promise<ActiveRubric> {
  const r = await loadActiveRubric(sb);
  if (!r) throw new PermanentJobError("No active rubric. Import and activate a rubric first.");
  return r;
}

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------
async function handleExtract(sb: SupabaseClient, job: Job) {
  const id = job.candidate_id!;
  const { data: cand, error } = await sb.from("candidates").select("*").eq("id", id).single();
  if (error || !cand) throw new PermanentJobError("Candidate not found");
  if (!cand.file_path) throw new PermanentJobError("File was never uploaded");
  await setCandidate(sb, id, { status: "extracting", last_error: null });

  const dl = await sb.storage.from("cvs").download(cand.file_path);
  if (dl.error || !dl.data) throw new Error(`Could not download CV: ${dl.error?.message ?? "empty"}`);
  const buf = Buffer.from(await dl.data.arrayBuffer());

  // Duplicate check on the server-computed hash (client hash is advisory).
  const sha = sha256Hex(buf);
  if (sha !== cand.file_sha256) {
    const { data: other } = await sb.from("candidates").select("id").eq("file_sha256", sha).neq("id", id).neq("status", "duplicate").limit(1);
    if (other?.length) {
      await setCandidate(sb, id, { status: "duplicate", duplicate_of: other[0].id, last_error: "Identical file already uploaded" });
      return { note: "duplicate" };
    }
    await setCandidate(sb, id, { file_sha256: sha });
  }

  const kind = detectKind(buf, cand.original_filename, cand.file_mime);
  if (kind === "unknown") throw new PermanentJobError("Unsupported file type. Upload PDF, DOCX or TXT.");

  let raw = "";
  let path: "text_layer" | "docx" | "plain_text" | "gemini_ocr";
  try {
    if (kind === "pdf") raw = (await pdfText(buf)).text;
    else if (kind === "docx") raw = await docxText(buf);
    else raw = txtText(buf);
  } catch (e) {
    if (kind !== "pdf") throw new PermanentJobError(`File could not be read (${(e as Error).message}). It may be corrupted or password-protected.`);
    raw = "";
  }
  path = kind === "pdf" ? "text_layer" : kind === "docx" ? "docx" : "plain_text";

  let extraction;
  let pre;
  if (kind === "pdf" && meaningfulChars(raw) < 200) {
    // Scanned / image-only PDF: the ORIGINAL file (with contact details) goes to Gemini for transcription.
    if (buf.length > 18 * 1024 * 1024) throw new PermanentJobError("Scanned PDF is too large for OCR (>18 MB).");
    const r = await aiExtract({ pdfBase64: buf.toString("base64") });
    if (r.value.document_quality === "unreadable" || !r.value.transcription || meaningfulChars(r.value.transcription) < 80)
      throw new PermanentJobError("Unreadable CV: no text layer and OCR could not read it. Ask for a text-based PDF or DOCX.");
    path = "gemini_ocr";
    pre = preRedactContacts(r.value.transcription);
    extraction = r;
  } else {
    if (meaningfulChars(raw) < 80) throw new PermanentJobError("CV appears empty or unreadable (almost no text).");
    pre = preRedactContacts(raw);
    extraction = await aiExtract({ text: pre.text.slice(0, 60_000) });
  }
  const ex = extraction.value;
  const fullName = ex.full_name?.trim() || null; // raw, verbatim — used for redaction
  const displayName = cleanPersonName(fullName); // cleaned — stored, displayed, used in greetings
  const firstName = firstNameOf(displayName);

  const red = redactIdentity(pre.text, {
    fullName,
    locationText: ex.location_text,
    sensitiveLines: ex.sensitive_personal_lines,
    emails: pre.captured.emails,
    phones: pre.captured.phones,
  });
  const idForCheck = { fullName, emails: pre.captured.emails, phones: pre.captured.phones };
  const headline = ex.headline ? redactIdentity(ex.headline, { fullName, locationText: null, sensitiveLines: [] }).text : null;

  const locText = ex.location_text ?? "";
  const locationSignal =
    ex.location_is_mumbai === "yes" || /\b(mumbai|bombay|navi mumbai|thane)\b/i.test(locText)
      ? "mumbai"
      : ex.location_is_mumbai === "no" || locText
        ? "outside_mumbai"
        : "not_stated";

  const injection = Array.from(new Set([...detectInjection(raw), ...(ex.injection_attempt_detected ? ["model-flagged"] : [])]));

  const { error: e1 } = await sb.from("candidate_identities").upsert({
    candidate_id: id,
    full_name: displayName,
    first_name: firstName,
    email: pre.captured.emails[0] ?? null,
    phone: pre.captured.phones[0] ?? null,
    location_text: ex.location_text,
    relocation_statement: ex.relocation_statement,
    profile_links: pre.captured.links,
    extracted_at: new Date().toISOString(),
  });
  if (e1) throw new Error(`identity: ${e1.message}`);

  const { error: e2 } = await sb.from("candidate_profiles").upsert({
    candidate_id: id,
    redacted_text: red.text,
    structured: {
      headline,
      roles: ex.roles.map((r) => ({ ...r, title: redactIdentity(r.title, { fullName, locationText: null, sensitiveLines: [] }).text })),
      extraction_ai_saw: path === "gemini_ocr" ? "original PDF (all identifiers)" : "CV text with email/phone/URLs pre-removed (name and location still present)",
    },
    location_signal: locationSignal,
    relocation_signal: ex.relocation_signal,
    extraction_path: path,
    extraction_model: extraction.model,
    document_quality: ex.document_quality,
    injection_flags: injection,
    redaction_report: { ...red.report, emailsCaptured: pre.captured.emails.length, phonesCaptured: pre.captured.phones.length, linksCaptured: pre.captured.links.length },
    char_count: red.text.length,
  });
  if (e2) throw new Error(`profile: ${e2.message}`);

  if (red.report.residual.length || residualIdentifierCheck(red.text, idForCheck).length) {
    throw new PermanentJobError(`Redaction check failed (${red.report.residual.join(", ")}). Scoring blocked to protect identifiers — review this CV manually.`);
  }

  // Possible duplicate person: a different file with the same email AND the same name (shared inboxes,
  // e.g. a course test address, are common, so email alone is not enough). Flagged, never merged.
  if (pre.captured.emails[0] && displayName) {
    const { data: same } = await sb.from("candidate_identities").select("candidate_id, full_name").eq("email", pre.captured.emails[0]).neq("candidate_id", id).limit(50);
    const match = (same ?? []).find((s) => samePerson(s.full_name, displayName));
    await setCandidate(sb, id, { possible_duplicate_of: match ? match.candidate_id : null });
  }

  await setCandidate(sb, id, { status: "extracted" });
  await enqueue(sb, "score", id, "PM", `score:${id}:PM`);
  await enqueue(sb, "score", id, "SPM", `score:${id}:SPM`);
  return { path, quality: ex.document_quality, injection };
}

// ---------------------------------------------------------------------------
// score (one role) — REDACTED text only
// ---------------------------------------------------------------------------
async function handleScore(sb: SupabaseClient, job: Job) {
  const id = job.candidate_id!;
  const role = job.role!;
  const rubric = await requireRubric(sb);
  const [{ data: cand }, { data: prof }, { data: ident }] = await Promise.all([
    sb.from("candidates").select("id, applied_role, status").eq("id", id).single(),
    sb.from("candidate_profiles").select("redacted_text, location_signal, relocation_signal").eq("candidate_id", id).single(),
    // Identity is read ONLY to run the redaction gate below; it is never put in the prompt.
    sb.from("candidate_identities").select("full_name, email, phone").eq("candidate_id", id).maybeSingle(),
  ]);
  if (!cand || !prof) throw new PermanentJobError("Candidate has not been extracted yet");
  assertRedacted(prof.redacted_text, { fullName: ident?.full_name ?? null, emails: ident?.email ? [ident.email] : [], phones: ident?.phone ? [ident.phone] : [] });
  if (cand.status !== "scored") await setCandidate(sb, id, { status: "scoring" });

  const rr = rubric.parsed.roles[role];
  const out = await aiScore({
    role,
    criteria: rr.criteria,
    essentials: rr.essentialRequirements,
    rules: rubric.parsed.rules,
    excludedSignals: rubric.parsed.excludedSignals,
    stage: STAGE,
    redactedText: prof.redacted_text,
    locationSignal: prof.location_signal === "mumbai" ? "Mumbai-based" : prof.location_signal === "outside_mumbai" ? "Located outside Mumbai" : "Not stated",
    relocationSignal: prof.relocation_signal === "willing" ? "States willingness to relocate / work in office" : prof.relocation_signal === "unwilling" ? "Explicitly states they will NOT relocate or work in office" : "Not stated",
  });

  const crit = enforceCriterionRules({ criteria: rr.criteria, model: out.value.criteria, cvText: prof.redacted_text, rules: rubric.parsed.rules, stage: STAGE });
  const ess = enforceEssentials({ requirements: rr.essentialRequirements, model: out.value.essential_requirements, cvText: prof.redacted_text, locationEvidence: null });
  const hay = normaliseForMatch(prof.redacted_text);
  const contradictions = out.value.contradictions.filter((c) => c.quotes.some((q) => quoteAppearsIn(q, hay)));
  const summary = computeScore(crit.results, rubric.parsed.rules, STAGE);
  const rec = recommend({ summary, results: crit.results, essentials: ess.results, contradictions, rules: rubric.parsed.rules });
  const log = [
    ...crit.log,
    ...ess.log,
    ...(out.value.contradictions.length !== contradictions.length ? [{ code: "contradictions", rule: "quotes must appear in CV", change: `${out.value.contradictions.length - contradictions.length} unverifiable contradiction(s) dropped` }] : []),
  ];

  await sb.from("evaluations").update({ is_current: false }).eq("candidate_id", id).eq("role", role).eq("is_current", true);
  const { error } = await sb.from("evaluations").insert({
    candidate_id: id,
    role,
    rubric_version_id: rubric.id,
    stage: STAGE,
    model: out.model,
    criterion_scores: crit.results,
    coverage_pct: summary.coveragePct,
    score: summary.score,
    essential_requirements: ess.results,
    recommendation: rec.primary,
    recommendation_reasons: { applicable: rec.applicable, reasons: rec.reasons, display: summary.display, interpretable: summary.interpretable },
    strongest_evidence: out.value.strongest_evidence,
    missing_evidence: out.value.missing_evidence,
    contradictions,
    rule_enforcement_log: log,
    is_current: true,
  });
  if (error) throw new Error(`evaluation insert: ${error.message}`);

  if (out.value.injection_attempt_detected) {
    const { data: p } = await sb.from("candidate_profiles").select("injection_flags").eq("candidate_id", id).single();
    const flags = Array.from(new Set([...(p?.injection_flags ?? []), "model-flagged-at-scoring"]));
    await sb.from("candidate_profiles").update({ injection_flags: flags }).eq("candidate_id", id);
  }

  const { data: evs } = await sb.from("evaluations").select("role").eq("candidate_id", id).eq("is_current", true).eq("rubric_version_id", rubric.id);
  const roles = new Set((evs ?? []).map((e) => e.role));
  if (roles.has("PM") && roles.has("SPM")) {
    await setCandidate(sb, id, { status: "scored", last_error: null });
    // Both rubrics done: decide which role this CV is ranked in (automatic unless the founder set it).
    await assignRole(sb, id, rubric, { actor: "system" });
  }
  return { display: summary.display, recommendation: rec.primary, overrides: log.length };
}

// ---------------------------------------------------------------------------
// Role assignment (automatic fit, founder override). Never decides or contacts anyone.
// ---------------------------------------------------------------------------
export type AssignOutcome = { role: Role | null; previous: Role | null; changed: boolean; locked: boolean; source: "auto" | "founder"; fit: RoleFit };

export async function assignRole(
  sb: SupabaseClient,
  id: string,
  rubric: ActiveRubric,
  opts: { actor: string; override?: Role | "auto" },
): Promise<AssignOutcome> {
  const [{ data: cand, error }, { data: evs }, { count: decisions }] = await Promise.all([
    sb.from("candidates").select("id, applied_role, role_source").eq("id", id).single(),
    sb.from("evaluations").select("role, score, coverage_pct").eq("candidate_id", id).eq("is_current", true).eq("rubric_version_id", rubric.id),
    sb.from("decisions").select("id", { count: "exact", head: true }).eq("candidate_id", id),
  ]);
  if (error || !cand) throw new PermanentJobError("Candidate not found");
  const pick = (r: Role) => {
    const e = (evs ?? []).find((x) => x.role === r);
    return e ? { score: e.score === null ? null : Number(e.score), coveragePct: Number(e.coverage_pct) } : null;
  };
  const fit = suggestRole(pick("PM"), pick("SPM"), rubric.parsed.rules);
  // Once a decision is recorded, the role that decision was made in is fixed. (Every send requires a
  // recorded decision, and decisions are append-only, so this also covers anyone already emailed.)
  const locked = (decisions ?? 0) > 0;
  const previous = (cand.applied_role as Role | null) ?? null;
  let source = cand.role_source as "auto" | "founder";
  let role = previous;
  if (!locked) {
    if (opts.override === "auto") source = "auto";
    else if (opts.override) {
      source = "founder";
      role = opts.override;
    }
    if (source === "auto") role = fit.role;
  }
  const changed = role !== previous;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { role_fit: { ...fit, rubric_version_id: rubric.id, computed_at: now }, role_source: source };
  if (changed) Object.assign(patch, { applied_role: role, role_assigned_at: now, in_top5: false, applied_rank: null, rank_tier: null, ranked_at: null });
  await setCandidate(sb, id, patch);
  if (changed) {
    // AI drafts were written for the previous role; the rank step regenerates them. Founder-edited drafts are kept.
    await sb.from("email_drafts").update({ is_current: false }).eq("candidate_id", id).eq("is_current", true).eq("origin", "ai");
    await audit(sb, opts.actor, opts.override && opts.override !== "auto" ? "role_overridden" : "role_auto_assigned", "candidates", id, {
      from: previous,
      to: role,
      basis: fit.basis,
      confidence: fit.confidence,
      reason: fit.reason,
    });
  }
  for (const r of ROLES) if (r === previous || r === role) await enqueue(sb, "rank", null, r, `rank:${r}`);
  return { role, previous, changed, locked, source, fit };
}

// ---------------------------------------------------------------------------
// rank (within assigned role) → schedules briefs (top 5) and drafts (everyone)
// ---------------------------------------------------------------------------
async function handleRank(sb: SupabaseClient, job: Job) {
  const role = job.role!;
  const rubric = await requireRubric(sb);
  const { data: cands, error } = await sb
    .from("candidates")
    .select("id, created_at, in_top5, status")
    .eq("applied_role", role)
    .not("status", "in", "(duplicate,awaiting_upload)");
  if (error) throw new Error(error.message);
  const { data: evs, error: e2 } = await sb
    .from("evaluations")
    .select("id, candidate_id, score, coverage_pct, stage")
    .eq("role", role)
    .eq("is_current", true)
    .eq("rubric_version_id", rubric.id)
    .in("candidate_id", (cands ?? []).map((c) => c.id));
  if (e2) throw new Error(e2.message);
  const evByCand = new Map((evs ?? []).map((e) => [e.candidate_id, e]));
  const rankable = (cands ?? []).filter((c) => evByCand.has(c.id));
  const ranked = rankWithinRole(
    rankable.map((c) => {
      const e = evByCand.get(c.id)!;
      return { candidateId: c.id, score: e.score === null ? null : Number(e.score), coveragePct: Number(e.coverage_pct), stage: e.stage, createdAt: c.created_at };
    }),
    rubric.parsed.rules,
  );
  const now = new Date().toISOString();
  for (const r of ranked)
    await setCandidate(sb, r.candidateId, { applied_rank: r.rank, rank_tier: r.tier, in_top5: r.inTop5, ranked_at: now });
  const unranked = (cands ?? []).filter((c) => !evByCand.has(c.id));
  for (const c of unranked) if (c.in_top5) await setCandidate(sb, c.id, { in_top5: false, applied_rank: null });

  // Schedule AI follow-ups. NOTE: nothing here sends or decides anything.
  const ids = ranked.map((r) => r.candidateId);
  const [{ data: briefs }, { data: drafts }] = await Promise.all([
    sb.from("briefs").select("candidate_id, evaluation_id").eq("role", role).eq("is_current", true).in("candidate_id", ids),
    sb.from("email_drafts").select("id, candidate_id, kind, suggested_by_rank").eq("is_current", true).in("candidate_id", ids),
  ]);
  const briefByCand = new Map((briefs ?? []).map((b) => [b.candidate_id, b.evaluation_id]));
  let briefsQueued = 0;
  let draftsQueued = 0;
  for (const r of ranked) {
    const ev = evByCand.get(r.candidateId)!;
    if (r.inTop5 && briefByCand.get(r.candidateId) !== ev.id) {
      await enqueue(sb, "brief", r.candidateId, role, `brief:${r.candidateId}:${role}`);
      briefsQueued++;
    }
    const suggested = r.inTop5 ? "invite" : "rejection";
    const mine = (drafts ?? []).filter((d) => d.candidate_id === r.candidateId);
    if (!mine.some((d) => d.kind === suggested)) {
      await enqueue(sb, "draft", r.candidateId, role, `draft:${r.candidateId}:${suggested}`, { kind: suggested });
      draftsQueued++;
    }
    for (const d of mine) {
      const should = d.kind === suggested;
      if (d.suggested_by_rank !== should) await sb.from("email_drafts").update({ suggested_by_rank: should }).eq("id", d.id);
    }
  }
  return { ranked: ranked.length, top5: ranked.filter((r) => r.inTop5).length, briefsQueued, draftsQueued };
}

// ---------------------------------------------------------------------------
// brief (top five only)
// ---------------------------------------------------------------------------
async function handleBrief(sb: SupabaseClient, job: Job) {
  const id = job.candidate_id!;
  const role = job.role!;
  const rubric = await requireRubric(sb);
  const [{ data: cand }, { data: ev }, { data: prof }, { data: ident }] = await Promise.all([
    sb.from("candidates").select("id, in_top5, applied_rank, applied_role").eq("id", id).single(),
    sb.from("evaluations").select("*").eq("candidate_id", id).eq("role", role).eq("is_current", true).maybeSingle(),
    sb.from("candidate_profiles").select("structured").eq("candidate_id", id).single(),
    sb.from("candidate_identities").select("full_name, email, phone").eq("candidate_id", id).maybeSingle(),
  ]);
  if (!cand || !ev) throw new PermanentJobError("No current evaluation");
  if (!cand.in_top5 || cand.applied_role !== role) return { skipped: "no longer in top five" };
  const results = ev.criterion_scores as CriterionResult[];
  const crit = rubric.parsed.roles[role].criteria;
  const targets = results
    .filter((r) => r.status === "NE" || r.confidence === "Low" || r.reScoreAfterInterview)
    .sort((a, b) => Number(a.status === "scored") - Number(b.status === "scored") || b.weight - a.weight)
    .map((r) => ({ code: r.code, name: r.name, probe: crit.find((c) => c.code === r.code)?.interviewProbe ?? "" }));
  const probeTargets = targets.length >= 3 ? targets : results.map((r) => ({ code: r.code, name: r.name, probe: crit.find((c) => c.code === r.code)?.interviewProbe ?? "" }));
  const out = await aiBrief({
    role,
    rank: cand.applied_rank ?? 0,
    scoreDisplay: (ev.recommendation_reasons as { display?: string })?.display ?? "",
    recommendation: ev.recommendation,
    results,
    essentials: ev.essential_requirements as EssentialResult[],
    strongest: ev.strongest_evidence,
    missing: ev.missing_evidence,
    probeTargets: probeTargets.slice(0, 6),
    headline: (prof?.structured as { headline?: string } | null)?.headline ?? null,
  });
  const idCheck = { fullName: ident?.full_name ?? null, emails: ident?.email ? [ident.email] : [], phones: ident?.phone ? [ident.phone] : [] };
  const all = [...out.value.sentences, ...out.value.interview_questions.map((q) => q.question)].join("\n");
  if (residualIdentifierCheck(all, idCheck).length) throw new GeminiMalformedError("Brief contained an identifier", "");
  const allowed = new Set(probeTargets.map((p) => p.code));
  const used = new Set<string>();
  const questions = out.value.interview_questions.map((q) => {
    const code = q.criterion_code.trim().toUpperCase();
    if (allowed.has(code) && !used.has(code)) {
      used.add(code);
      return { criterion_code: code, question: q.question, why: q.why, source: "ai" };
    }
    const fallback = probeTargets.find((p) => !used.has(p.code))!;
    used.add(fallback.code);
    return { criterion_code: fallback.code, question: fallback.probe, why: "Rubric interview probe (AI question was not tied to an NE / low-confidence criterion).", source: "rubric" };
  });
  await sb.from("briefs").update({ is_current: false }).eq("candidate_id", id).eq("role", role).eq("is_current", true);
  const { error } = await sb.from("briefs").insert({
    candidate_id: id,
    role,
    evaluation_id: ev.id,
    rubric_version_id: rubric.id,
    sentences: out.value.sentences.map((s) => s.trim()),
    interview_questions: questions,
    model: out.model,
    is_current: true,
  });
  if (error) throw new Error(`brief insert: ${error.message}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// draft (every candidate) — placeholders only, never sent from here
// ---------------------------------------------------------------------------
async function handleDraft(sb: SupabaseClient, job: Job) {
  const id = job.candidate_id!;
  const kind = (job.payload.kind as "invite" | "rejection") ?? "rejection";
  const regenerate = Boolean(job.payload.regenerate);
  const [{ data: cand }, { data: existing }, { data: ev }, { data: ident }] = await Promise.all([
    sb.from("candidates").select("id, applied_role, in_top5").eq("id", id).single(),
    sb.from("email_drafts").select("id, version, origin").eq("candidate_id", id).eq("kind", kind).eq("is_current", true).maybeSingle(),
    sb.from("evaluations").select("strongest_evidence").eq("candidate_id", id).eq("role", job.role ?? "PM").eq("is_current", true).maybeSingle(),
    sb.from("candidate_identities").select("full_name, email, phone").eq("candidate_id", id).maybeSingle(),
  ]);
  if (!cand) throw new PermanentJobError("Candidate not found");
  if (!cand.applied_role) return { skipped: "no role assigned" };
  if (existing && !regenerate) return { skipped: "draft exists" };
  const idCheck = { fullName: ident?.full_name ?? null, emails: ident?.email ? [ident.email] : [], phones: ident?.phone ? [ident.phone] : [] };
  const hint = ev?.strongest_evidence && !residualIdentifierCheck(ev.strongest_evidence, idCheck).length ? ev.strongest_evidence : null;
  const out = await aiDraft({ kind, role: cand.applied_role, strengthHint: kind === "invite" ? hint : null });
  const problems = validateTemplate(out.value.subject, out.value.body);
  if (problems.length) throw new GeminiMalformedError(`Draft template invalid: ${problems.join("; ")}`, out.value.body);
  if (residualIdentifierCheck(out.value.subject + "\n" + out.value.body, idCheck).length) throw new GeminiMalformedError("Draft contained an identifier", "");
  if (existing) await sb.from("email_drafts").update({ is_current: false }).eq("id", existing.id);
  const suggestedKind = cand.in_top5 ? "invite" : "rejection";
  const { error } = await sb.from("email_drafts").insert({
    candidate_id: id,
    kind,
    subject_template: out.value.subject.trim(),
    body_template: out.value.body.trim(),
    version: (existing?.version ?? 0) + 1,
    origin: "ai",
    model: out.model,
    suggested_by_rank: kind === suggestedKind,
    is_current: true,
  });
  if (error) throw new Error(`draft insert: ${error.message}`);
  return { ok: true };
}

const HANDLERS: Record<Job["kind"], (sb: SupabaseClient, job: Job) => Promise<unknown>> = {
  extract: handleExtract,
  score: handleScore,
  rank: handleRank,
  brief: handleBrief,
  draft: handleDraft,
};

// ---------------------------------------------------------------------------
// Runner: claim → run → settle. Short, bounded ticks; safe to call repeatedly.
// ---------------------------------------------------------------------------
export type TickResult = {
  processed: { id: number; kind: string; outcome: "done" | "retry" | "failed" | "deferred"; detail?: string }[];
  blocked: string | null;
  retryAfterSec: number | null;
};

export async function runTick(sb: SupabaseClient, worker: string, opts: { startNewBeforeMs?: number } = {}): Promise<TickResult> {
  const started = Date.now();
  const startNewBeforeMs = opts.startNewBeforeMs ?? 18_000;
  const result: TickResult = { processed: [], blocked: null, retryAfterSec: null };
  while (Date.now() - started < startNewBeforeMs) {
    const { data, error } = await sb.rpc("claim_jobs", { p_limit: 1, p_worker: worker });
    if (error) throw new Error(`claim_jobs: ${error.message}`);
    const job = (data as Job[] | null)?.[0];
    if (!job) break;
    try {
      const detail = await HANDLERS[job.kind](sb, job);
      await sb.from("jobs").update({ status: "done", locked_at: null, last_error: null, payload: { ...job.payload, result: detail ?? null } }).eq("id", job.id);
      result.processed.push({ id: job.id, kind: job.kind, outcome: "done" });
    } catch (e) {
      const err = e as Error;
      const settle = async (patch: Record<string, unknown>) => sb.from("jobs").update({ locked_at: null, locked_by: null, ...patch }).eq("id", job.id);
      const later = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();
      if (err instanceof GeminiRateLimitError) {
        await settle({ status: "queued", attempts: Math.max(0, job.attempts - 1), run_after: later(err.retryAfterSec), last_error: err.message });
        result.processed.push({ id: job.id, kind: job.kind, outcome: "deferred", detail: "rate limited" });
        result.retryAfterSec = err.retryAfterSec;
        break;
      }
      if (err instanceof GeminiConfigError || (err instanceof GeminiError && !err.retryable && (err.status === 401 || err.status === 403 || err.status === 404))) {
        await settle({ status: "queued", attempts: Math.max(0, job.attempts - 1), run_after: later(300), last_error: err.message });
        result.processed.push({ id: job.id, kind: job.kind, outcome: "deferred", detail: err.message });
        result.blocked = err.message;
        break;
      }
      const permanent = err instanceof PermanentJobError;
      const exhausted = job.attempts >= job.max_attempts;
      if (permanent || exhausted) {
        await settle({ status: "failed", last_error: err.message });
        if (job.candidate_id && job.kind !== "rank") await setCandidate(sb, job.candidate_id, { status: "needs_attention", last_error: `${job.kind}: ${err.message}` }).catch(() => {});
        await audit(sb, worker, "job_failed", "job", String(job.id), { kind: job.kind, error: err.message });
        result.processed.push({ id: job.id, kind: job.kind, outcome: "failed", detail: err.message });
      } else {
        const backoff = Math.min(600, 15 * 2 ** job.attempts);
        await settle({ status: "queued", run_after: later(backoff), last_error: err.message });
        result.processed.push({ id: job.id, kind: job.kind, outcome: "retry", detail: err.message });
      }
    }
  }
  return result;
}

export async function queueCounts(sb: SupabaseClient) {
  const { data, error } = await sb.from("jobs").select("status, kind, run_after").in("status", ["queued", "running", "failed"]);
  if (error) throw new Error(error.message);
  const now = Date.now();
  const rows = data ?? [];
  const ready = rows.filter((r) => r.status === "queued" && new Date(r.run_after).getTime() <= now).length;
  const waiting = rows.filter((r) => r.status === "queued" && new Date(r.run_after).getTime() > now);
  const nextAt = waiting.length ? Math.min(...waiting.map((r) => new Date(r.run_after).getTime())) : null;
  return {
    ready,
    waiting: waiting.length,
    running: rows.filter((r) => r.status === "running").length,
    failed: rows.filter((r) => r.status === "failed").length,
    nextRunInSec: nextAt ? Math.max(1, Math.ceil((nextAt - now) / 1000)) : null,
    byKind: rows.filter((r) => r.status !== "failed").reduce<Record<string, number>>((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {}),
  };
}
