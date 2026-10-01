import { readFileSync, writeFileSync } from "node:fs";
import { ExtractionSchema } from "../src/lib/ai/tasks";
import { preRedactContacts, redactIdentity, residualIdentifierCheck, detectInjection } from "../src/lib/redaction";
const [S] = process.argv.slice(2);
const map: Record<string, string> = { strong: "SYNTHETIC_strong_PM_Asha_Varma.txt", weak: "SYNTHETIC_weak_SPM_Rohit_Kale.txt", inject: "SYNTHETIC_injection_attempt_Test_Person.txt" };
const out: Record<string, unknown> = {};
for (const [k, f] of Object.entries(map)) {
  const raw = readFileSync(`fixtures/synthetic-cvs/${f}`, "utf8");
  const ex = ExtractionSchema.parse(JSON.parse(readFileSync(`${S}/ex_${k}.json`, "utf8")));
  const pre = preRedactContacts(raw);
  const red = redactIdentity(pre.text, { fullName: ex.full_name, locationText: ex.location_text, sensitiveLines: ex.sensitive_personal_lines, emails: pre.captured.emails, phones: pre.captured.phones });
  const loc = ex.location_is_mumbai === "yes" ? "Mumbai-based" : ex.location_is_mumbai === "no" ? "Located outside Mumbai" : "Not stated";
  out[k] = { redacted: red.text, residual: residualIdentifierCheck(red.text, { fullName: ex.full_name, emails: pre.captured.emails, phones: pre.captured.phones }), report: red.report, loc, rel: "Not stated", injectionLocal: detectInjection(raw), identity: { name: ex.full_name, email: pre.captured.emails[0] ?? null, phone: pre.captured.phones[0] ?? null } };
}
writeFileSync(`${S}/redacted.json`, JSON.stringify(out));
for (const [k, v] of Object.entries(out) as [string, { redacted: string; residual: string[]; report: unknown; injectionLocal: string[] }][]) {
  console.log(`== ${k} residual=${JSON.stringify(v.residual)} injection=${JSON.stringify(v.injectionLocal)} report=${JSON.stringify(v.report)}`);
  console.log(v.redacted);
}
