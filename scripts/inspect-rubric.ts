import { readFileSync } from "node:fs";
import { parseRubixText } from "../src/lib/rubric/parse-rubix";
import { validateRubric } from "../src/lib/rubric/validate";

const path = process.argv[2] ?? "rubric/Rubix.txt";
const parsed = parseRubixText(readFileSync(path, "utf8"));
const v = validateRubric(parsed);
console.log(JSON.stringify({ version: parsed.versionLabel, status: parsed.declaredStatus, rules: parsed.rules, validation: v }, null, 2));
for (const role of ["PM", "SPM"] as const) {
  for (const c of parsed.roles[role].criteria) {
    console.log(c.code, c.weight, c.evidenceMode, c.name, "| refs:", c.hypothesisRefs.join(","), "| anchors:", Object.keys(c.anchors).length, "| a1:", c.anchors["1"].slice(0, 60));
  }
  for (const e of parsed.roles[role].essentialRequirements) console.log(e.code, e.essentialityConfirmed, "|", e.statusRuleResolved.slice(0, 90));
}
console.log("hypotheses", parsed.hypotheses.length, "excluded", parsed.excludedSignals.length, "gaps", parsed.gaps.map((g) => g.id).join(","), "questions", parsed.founderQuestions.length);
