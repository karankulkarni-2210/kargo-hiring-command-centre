import { requireFounderPage } from "@/lib/auth";
import type { ParsedRubric, Role, RubricValidation } from "@/lib/rubric/types";
import { ROLE_TITLES } from "@/lib/rubric/types";
import { Badge, Card, EmptyState, Notice, cx } from "@/components/ui";
import { Tabs } from "@/components/role-tabs";
import { RubricActions, RubricImport } from "./client";

export const dynamic = "force-dynamic";

export default async function RubricPage() {
  const { supabase } = await requireFounderPage();
  const { data: versions } = await supabase
    .from("rubric_versions")
    .select("id, version_label, source_filename, source_sha256, parse_method, declared_status, is_active, imported_at, imported_by, activated_at, validation")
    .order("imported_at", { ascending: false });
  const active = versions?.find((v) => v.is_active);
  const { data: full } = active ? await supabase.from("rubric_versions").select("parsed, source_text").eq("id", active.id).single() : { data: null };
  const { data: evalCount } = active ? await supabase.from("evaluations").select("rubric_version_id").eq("is_current", true) : { data: [] };
  const parsed = full?.parsed as ParsedRubric | undefined;
  const v = active?.validation as RubricValidation | undefined;
  const staleEvals = (evalCount ?? []).filter((e) => e.rubric_version_id !== active?.id).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rubric</h1>
          <p className="mt-1 text-sm text-muted">Imported verbatim from your source file. The app does not rewrite criteria, invent historical support, or claim calibration.</p>
        </div>
        {active && <RubricActions activeId={active.id} staleEvals={staleEvals} />}
      </div>

      {!active || !parsed || !v ? (
        <EmptyState title="No active rubric">Import a rubric below.</EmptyState>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card title={parsed.title} subtitle={`Version ${parsed.versionLabel}${parsed.preparedDate ? ` · prepared ${parsed.preparedDate}` : ""} · ${active.source_filename}`}>
              <div className="flex flex-wrap gap-2">
                <Badge tone={/PROVISIONAL/i.test(parsed.declaredStatus) ? "warn" : "ok"}>Status: {parsed.declaredStatus}</Badge>
                <Badge tone={v.calibrated ? "ok" : "warn"}>{v.calibrated ? "Calibrated" : "Not calibrated against past hires"}</Badge>
                <Badge>Parsed: {active.parse_method}</Badge>
                <Badge>Historical hire records: {parsed.historicalRecordsAvailable}</Badge>
                <Badge tone={v.ok ? "ok" : "danger"}>{v.ok ? "Validation passed" : "Validation errors"}</Badge>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-muted">{parsed.statusStatement}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(["PM", "SPM"] as Role[]).map((role) => (
                  <div key={role} className="rounded-lg border border-line bg-surface-2 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-accent-strong">{role}</span>
                      <Badge tone={v.weightTotals[role] === 100 ? "ok" : "danger"}>Σ weights {v.weightTotals[role]}%</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted">
                      {v.assignmentFit.perRole[role].criteriaCount} criteria · max CV-stage coverage {v.maxCvStageCoveragePct[role]}% · {v.assignmentFit.perRole[role].historicallySupportedCriteria} historically supported
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 font-mono text-[10px] text-faint">sha256 {active.source_sha256.slice(0, 16)}… · imported {new Date(active.imported_at).toLocaleString("en-IN")}</div>
            </Card>

            <Card title="Assignment-fit check" subtitle="MESA Case 2 asks for 4–6 historically supported criteria per role">
              <ul className="space-y-2.5">
                {v.issues
                  .filter((i) => i.level !== "info")
                  .map((i, k) => (
                    <li key={k} className="flex gap-2 text-[13px] leading-relaxed">
                      <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", i.level === "error" ? "bg-danger" : "bg-warn")} />
                      <span className="text-muted">
                        {i.role && <span className="mr-1 font-mono text-text">{i.role}</span>}
                        {i.message}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="mt-4 text-xs text-faint">Flags are informational and are not auto-fixed. Replace the rubric with a corrected version once hires/ data supports it — no rebuild required.</p>
            </Card>
          </div>

          <Card title="Criteria, weights and anchors" subtitle="Weights are PROPOSED JUDGMENT per the source. Pattern confidence is Not established for every criterion.">
            <Tabs
              initial="PM"
              tabs={(["PM", "SPM"] as Role[]).map((role) => ({
                key: role,
                label: `${role} · ${ROLE_TITLES[role]} (${parsed.roles[role].criteria.length})`,
                content: <RoleCriteria parsed={parsed} role={role} />,
              }))}
            />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Scoring rules in force" subtitle="Section 6 of the source, applied in application code">
              <ul className="space-y-2 text-[13px] leading-relaxed text-muted">
                <li>· Coverage minimum for interpreting a total: <span className="font-mono text-text">{parsed.rules.coverageMinimumPct}%</span></li>
                <li>· Comparable coverage gap for ranking: <span className="font-mono text-text">{parsed.rules.maxComparableCoverageGapPct} pp</span></li>
                <li>· CV-PARTIAL confidence cap: <span className="text-text">{parsed.rules.cvPartialConfidenceCap}</span>; High is never assigned at CV screen</li>
                <li>· Interview-only criteria NE at CV screen: <span className="text-text">{parsed.rules.interviewOnlyMustBeNEAtCvStage ? "yes" : "no"}</span></li>
                <li>· 1–2 requires explicit negative evidence: <span className="text-text">{parsed.rules.lowScoreRequiresExplicitNegativeEvidence ? "yes" : "no"}</span></li>
                <li>· No automatic accept/reject thresholds: <span className="text-text">{parsed.rules.noAutomaticThresholds ? "yes" : "no"}</span></li>
              </ul>
              <pre className="mt-4 overflow-auto rounded-lg border border-line bg-bg/60 p-3 font-mono text-[11px] leading-relaxed text-muted">{parsed.rules.formulaText}</pre>
            </Card>
            <Card title="Open questions for the founder" subtitle="From Section 8.3 — these drive calibration">
              <ol className="space-y-2.5 text-[13px] leading-relaxed text-muted">
                {parsed.founderQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </Card>
          </div>

          <details className="rounded-xl border border-line bg-surface/80">
            <summary className="cursor-pointer px-5 py-3.5 text-[13px] font-semibold">Original source file (verbatim, as stored in Supabase)</summary>
            <pre className="max-h-[560px] overflow-auto border-t border-line px-5 py-4 font-mono text-[11px] leading-relaxed text-muted">{full?.source_text}</pre>
          </details>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Replace the rubric" subtitle="Imported as a new, inactive version. Activate it to use it; past evaluations keep their version.">
          <RubricImport />
        </Card>
        <Card title="Versions">
          <ul className="divide-y divide-line">
            {(versions ?? []).map((x) => {
              const vv = x.validation as RubricValidation;
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className="font-mono">v{x.version_label}</span>
                  <Badge tone={/PROVISIONAL/i.test(x.declared_status) ? "warn" : "ok"}>{x.declared_status}</Badge>
                  {x.is_active && <Badge tone="accent">Active</Badge>}
                  {!vv.ok && <Badge tone="danger">Invalid</Badge>}
                  <span className="text-xs text-faint">{x.source_filename} · {x.parse_method}</span>
                  <span className="ml-auto">{!x.is_active && vv.ok && <RubricActions activateId={x.id} />}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      {staleEvals > 0 && <Notice title={`${staleEvals} current evaluation(s) were produced by an older rubric version`}>Use “Re-score with active rubric” to evaluate them again. Old evaluations remain linked to the version that produced them.</Notice>}
    </div>
  );
}

function RoleCriteria({ parsed, role }: { parsed: ParsedRubric; role: Role }) {
  const rr = parsed.roles[role];
  return (
    <div className="space-y-3">
      {rr.criteria.map((c) => (
        <details key={c.code} className="group rounded-lg border border-line bg-surface-2/70">
          <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
            <span className="font-mono text-xs text-accent-strong">{c.code}</span>
            <span className="text-sm font-medium">{c.name}</span>
            <Badge>{c.evidenceMode}</Badge>
            <span className="ml-auto flex items-center gap-3">
              <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-surface-3 sm:block">
                <span className="block h-full bg-accent" style={{ width: `${c.weight * 4}%` }} />
              </span>
              <span className="w-10 text-right font-mono text-sm tabular-nums">{c.weight}%</span>
            </span>
          </summary>
          <div className="space-y-3 border-t border-line px-4 py-3 text-[13px] leading-relaxed">
            <div className="flex flex-wrap gap-2">
              <Badge tone="warn">Historical support: {c.historicalSupport.supportingCases} / {c.historicalSupport.relevantCases} cases</Badge>
              <Badge>Pattern confidence: {c.patternConfidence}</Badge>
              {c.hypothesisRefs.map((h) => (
                <Badge key={h}>JD hypothesis {h}</Badge>
              ))}
              <Badge>{c.weightNote || "weight as stated"}</Badge>
            </div>
            <p className="text-muted"><span className="text-faint">Expected outcome · </span>{c.expectedOutcome}</p>
            <p className="text-muted"><span className="text-faint">Source support · </span>{c.basis}</p>
            <ol className="space-y-1.5">
              {(["1", "2", "3", "4", "5"] as const).map((k) => (
                <li key={k} className="grid grid-cols-[22px_1fr] gap-2">
                  <span className="font-mono text-accent-strong">{k}</span>
                  <span className="text-muted">{c.anchors[k]}</span>
                </li>
              ))}
            </ol>
            <p className="text-muted"><span className="text-faint">Acceptable evidence · </span>{c.acceptableEvidence}</p>
            <p className="text-muted"><span className="text-faint">Interview probe · </span>{c.interviewProbe}</p>
          </div>
        </details>
      ))}
      <div className="rounded-lg border border-line p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Essential requirements (status only, never scored)</div>
        <ul className="space-y-2 text-[13px]">
          {rr.essentialRequirements.map((e) => (
            <li key={e.code}>
              <span className="font-mono text-xs text-accent-strong">{e.code}</span> <span>{e.requirement}</span>{" "}
              {!e.essentialityConfirmed && <Badge tone="warn">essentiality to be confirmed</Badge>}
              <div className="mt-0.5 text-xs text-muted">{e.statusRuleResolved}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
