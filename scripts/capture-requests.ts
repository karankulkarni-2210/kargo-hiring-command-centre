/**
 * Dev helper: builds the EXACT Gemini request bodies the app sends (by intercepting fetch), so
 * they can be replayed from a machine that can reach the Gemini API. No network call is made.
 * Usage: npx tsx --conditions=react-server scripts/capture-requests.ts <mode> <outdir> [args]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { aiExtract, aiScore } from "../src/lib/ai/tasks";
import { parseRubixText } from "../src/lib/rubric/parse-rubix";
import { preRedactContacts } from "../src/lib/redaction";

process.env.GEMINI_API_KEY = "capture-only";
let captured: unknown = null;
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  captured = JSON.parse(String(init.body));
  throw new Error("captured");
}) as typeof fetch;

const [mode, out, ...rest] = process.argv.slice(2);
const out_ = out;
async function grab(fn: () => Promise<unknown>) {
  captured = null;
  await fn().catch(() => {});
  return captured;
}
(async () => {
  if (mode === "extract") {
    for (const f of rest) {
      const pre = preRedactContacts(readFileSync(`fixtures/synthetic-cvs/${f}`, "utf8"));
      writeFileSync(`${out}/extract_${f}.json`, JSON.stringify(await grab(() => aiExtract({ text: pre.text }))));
      writeFileSync(`${out}/pre_${f}.json`, JSON.stringify(pre));
    }
  } else if (mode === "score-template") {
    const r = parseRubixText(readFileSync("rubric/Rubix.txt", "utf8"));
    for (const role of ["PM", "SPM"] as const) {
      const body = await grab(() =>
        aiScore({ role, criteria: r.roles[role].criteria, essentials: r.roles[role].essentialRequirements, rules: r.rules, excludedSignals: r.excludedSignals, stage: "CV screen", redactedText: "__CV__", locationSignal: "__LOC__", relocationSignal: "__REL__" }),
      );
      writeFileSync(`${out}/score_template_${role}.json`, JSON.stringify(body));
    }
  }
})();

// Extra modes: brief + drafts, built from the live-captured strong-PM evaluation.
import { aiBrief, aiDraft } from "../src/lib/ai/tasks";
import { computeScore, enforceCriterionRules, enforceEssentials, recommend } from "../src/lib/scoring/engine";
import { ScoringSchema } from "../src/lib/ai/tasks";
(async () => {
  if (mode !== "brief-draft") return;
  const r = parseRubixText(readFileSync("rubric/Rubix.txt", "utf8"));
  const live = JSON.parse(readFileSync("tests/live-captures/gemini-3.8-flash_scoring_2026-10-01.json", "utf8"));
  const red = JSON.parse(readFileSync("tests/live-captures/redacted_synthetic.json", "utf8"));
  const out = ScoringSchema.parse(live.strong_PM);
  const c = enforceCriterionRules({ criteria: r.roles.PM.criteria, model: out.criteria, cvText: red.strong.redacted, rules: r.rules, stage: "CV screen" });
  const e = enforceEssentials({ requirements: r.roles.PM.essentialRequirements, model: out.essential_requirements, cvText: red.strong.redacted, locationEvidence: null });
  const s = computeScore(c.results, r.rules, "CV screen");
  const rec = recommend({ summary: s, results: c.results, essentials: e.results, contradictions: [], rules: r.rules });
  const targets = c.results.filter((x) => x.status === "NE" || x.reScoreAfterInterview).map((x) => ({ code: x.code, name: x.name, probe: r.roles.PM.criteria.find((k) => k.code === x.code)!.interviewProbe }));
  writeFileSync(`${out_}/brief.json`, JSON.stringify(await grab(() => aiBrief({ role: "PM", rank: 1, scoreDisplay: s.display, recommendation: rec.primary, results: c.results, essentials: e.results, strongest: out.strongest_evidence, missing: out.missing_evidence, probeTargets: targets, headline: "Product Manager" }))));
  writeFileSync(`${out_}/draft_invite.json`, JSON.stringify(await grab(() => aiDraft({ kind: "invite", role: "PM", strengthHint: out.strongest_evidence }))));
  writeFileSync(`${out_}/draft_rejection.json`, JSON.stringify(await grab(() => aiDraft({ kind: "rejection", role: "SPM", strengthHint: null }))));
})();
