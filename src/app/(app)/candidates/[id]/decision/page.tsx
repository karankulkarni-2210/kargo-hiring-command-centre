import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFounderPage } from "@/lib/auth";
import { candidateDetail } from "@/lib/data";
import { checkSendEligibility, emailReadiness, readEmailConfig, renderTemplate, resolveDestination, testModeBanner, DECISION_TO_KIND } from "@/lib/email/core";
import { ROLE_TITLES } from "@/lib/rubric/types";
import { Badge, Card, DECISION_LABEL, DECISION_TONE, Notice, ScoreCoverage, recTone } from "@/components/ui";
import { DecisionForm, DraftWorkspace } from "./client";

export const dynamic = "force-dynamic";

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireFounderPage();
  const d = await candidateDetail(supabase, id);
  if (!d) notFound();
  const { cand: c, ident } = d;
  if (!c.applied_role) {
    return (
      <div className="space-y-6">
        <Link href={`/candidates/${c.id}`} className="text-xs text-faint hover:text-text">← Candidate</Link>
        <Notice title="No role assigned yet">
          This CV has no scorable evidence for either role, so it was not placed automatically. Choose PM or SPM on the candidate page first; decisions and emails are tied to a role.
        </Notice>
      </div>
    );
  }
  const cand = { ...c, applied_role: c.applied_role };
  const ev = d.evalByRole[cand.applied_role];
  const decision = d.decisions[0] ?? null;
  const config = readEmailConfig();
  const readiness = emailReadiness(config);
  const { mode, destination } = resolveDestination(config, ident?.email ?? null);
  const suggestedKind = cand.in_top5 ? "invite" : "rejection";
  const decisionKind = decision ? DECISION_TO_KIND[decision.decision] : null;

  const vars = { first_name: ident?.first_name ?? "", role_title: ROLE_TITLES[cand.applied_role], company_name: config.companyName, sender_name: config.senderName };
  const existing = d.sends.map((s) => ({ mode: s.mode, status: s.status, kind: s.kind, draftId: s.draft_id, draftVersion: s.draft_version }));

  const drafts = (["invite", "rejection"] as const).map((kind) => {
    const draft = d.drafts.find((x) => x.kind === kind) ?? null;
    if (!draft) return { kind, draft: null, preview: null, eligibility: null };
    const subj = renderTemplate(draft.subject_template, vars);
    const body = renderTemplate(draft.body_template, vars);
    const eligibility = checkSendEligibility({
      config,
      decision: decision ? { id: decision.id, decision: decision.decision } : null,
      draft: { id: draft.id, kind: draft.kind, version: draft.version, subject: draft.subject_template, body: draft.body_template },
      candidateEmail: ident?.email ?? null,
      candidateFirstName: ident?.first_name ?? null,
      confirm: { confirmed: true, destinationShown: destination, draftVersionShown: draft.version },
      existing,
    });
    return {
      kind,
      draft,
      preview: {
        subject: mode === "test" ? `[TEST] ${subj.text}` : subj.text,
        body: (mode === "test" ? testModeBanner(ident?.email ?? null, ident?.full_name ?? null) : "") + body.text,
        unresolved: [...subj.unresolved, ...body.unresolved],
      },
      eligibility: eligibility.allowed ? { allowed: true as const, reasons: [] } : { allowed: false as const, reasons: eligibility.reasons, code: eligibility.code },
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/candidates/${cand.id}`} className="text-xs text-faint hover:text-text">← Candidate</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Decision & email review</h1>
        <p className="mt-1 text-sm text-muted">
          {ident?.full_name ?? cand.original_filename} · ranked in {ROLE_TITLES[cand.applied_role]} ({cand.applied_role}, {cand.role_source === "founder" ? "set by you" : "automatic fit"})
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <Card title="System recommendation" subtitle="AI output — kept separate from your decision. It authorises nothing.">
            {ev ? (
              <div className="space-y-3">
                <ScoreCoverage score={ev.score === null ? null : Number(ev.score)} coverage={Number(ev.coverage_pct)} interpretable={ev.recommendation_reasons?.interpretable} />
                <div className="font-mono text-xs text-muted">{ev.recommendation_reasons?.display}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(ev.recommendation_reasons?.applicable ?? [ev.recommendation]).map((r) => (
                    <Badge key={r} tone={recTone(r)}>{r}</Badge>
                  ))}
                  {cand.applied_rank !== null && <Badge>#{cand.applied_rank} in {cand.applied_role}</Badge>}
                </div>
                <p className="text-xs text-muted">
                  Shortlist position suggests a <span className="text-text">{suggestedKind}</span> draft. That is a suggestion for which draft to prepare — not a decision.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">Not scored yet.</p>
            )}
          </Card>

          <Card title="Your decision" subtitle="Advance, Hold or Decline — with a rationale. Recorded with timestamp; never sends anything by itself.">
            <DecisionForm candidateId={cand.id} current={decision?.decision ?? null} />
            {d.decisions.length > 0 && (
              <ul className="mt-5 space-y-2 border-t border-line pt-4">
                {d.decisions.map((x) => (
                  <li key={x.id} className="text-xs">
                    <div className="flex items-center gap-2">
                      <Badge tone={DECISION_TONE[x.decision]}>{DECISION_LABEL[x.decision]}</Badge>
                      <span className="text-faint">{new Date(x.decided_at).toLocaleString("en-IN")} · {x.decided_by_email}</span>
                    </div>
                    <p className="mt-1 text-muted">{x.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Send history" subtitle="Every attempt, with provider message ID or failure.">
            {d.sends.length === 0 ? (
              <p className="text-sm text-muted">Nothing has been sent for this candidate.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {d.sends.map((s) => (
                  <li key={s.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={s.status === "sent" ? "ok" : s.status === "failed" ? "danger" : "warn"}>{s.status}</Badge>
                      <Badge tone={s.mode === "test" ? "cyan" : "danger"}>{s.mode}</Badge>
                      <span>{s.kind} v{s.draft_version}</span>
                      <span className="text-faint">→ {s.to_email}</span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-faint">
                      {new Date(s.confirmed_at).toLocaleString("en-IN")} · {s.provider_message_id ? `id ${s.provider_message_id}` : s.error ?? "pending"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {!readiness.ready ? (
            <Notice tone="danger" title={readiness.label}>{readiness.detail}</Notice>
          ) : (
            <Notice tone={mode === "test" ? "cyan" : "danger"} title={readiness.label}>{readiness.detail}</Notice>
          )}
          {decision && !decisionKind && <Notice title="Decision is Hold">No email is sent for Hold. Drafts stay available if you change the decision.</Notice>}
          <DraftWorkspace
            candidateId={cand.id}
            initialKind={decisionKind ?? suggestedKind}
            suggestedKind={suggestedKind}
            decisionKind={decisionKind}
            destination={destination}
            mode={mode}
            intended={ident?.email ?? null}
            candidateName={ident?.full_name ?? null}
            drafts={drafts}
          />
        </div>
      </div>
    </div>
  );
}
