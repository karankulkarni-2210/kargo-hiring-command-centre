import { HttpError, withFounder } from "@/lib/auth";
import { parseRubricSource, verifyAgainstSource } from "@/lib/rubric/import";
import { RubricParseError } from "@/lib/rubric/parse-rubix";
import { validateRubric } from "@/lib/rubric/validate";
import { buildRubricRows, insertRubric, loadActiveRubric } from "@/lib/rubric/store";
import { aiStructureRubric } from "@/lib/ai/rubric-assist";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Import a replacement rubric (stored INACTIVE). The original file text is kept verbatim.
 * mode=auto: deterministic Rubix-text or JSON parse. mode=ai: Gemini transcription, then a
 * verbatim check against the source — any mismatch blocks activation.
 */
export async function POST(req: Request) {
  return withFounder(async ({ supabase, email }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const mode = (form?.get("mode") as string) || "auto";
    if (!(file instanceof File)) throw new HttpError(400, "Attach a rubric file (.txt or .json).");
    if (file.size > 1_000_000) throw new HttpError(400, "Rubric file is larger than 1 MB.");
    const text = await file.text();

    let parsed;
    let method: "rubix_text" | "json" | "ai_assisted";
    let verification: string[] = [];
    try {
      if (mode === "ai") {
        const active = await loadActiveRubric(supabase);
        if (!active) throw new HttpError(400, "AI-assisted import needs an existing rubric to inherit scoring-rule text from.");
        parsed = await aiStructureRubric(text, active.parsed.rules);
        method = "ai_assisted";
      } else {
        const r = parseRubricSource(text, file.name);
        parsed = r.parsed;
        method = r.method;
      }
    } catch (e) {
      if (e instanceof RubricParseError) throw new HttpError(422, e.message, { details: e.details, hint: "Use the Rubix text layout, a JSON export of the rubric schema, or AI-assisted import." });
      throw e;
    }
    if (method !== "rubix_text") verification = verifyAgainstSource(parsed, text);
    const validation = validateRubric(parsed);
    if (verification.length) {
      validation.issues.unshift(...verification.map((m) => ({ level: "error" as const, code: "not_verbatim", message: m })));
      validation.ok = false;
    }
    const rows = buildRubricRows({ parsed, validation, sourceText: text, sourceFilename: file.name, parseMethod: method, importedBy: email });
    const id = await insertRubric(supabase, rows).catch((e: Error) => {
      throw new HttpError(409, e.message);
    });
    await supabase.from("audit_log").insert({ actor: email, action: "rubric_imported", entity: "rubric_version", entity_id: id, details: { method, ok: validation.ok } });
    return { id, method, validation };
  });
}
