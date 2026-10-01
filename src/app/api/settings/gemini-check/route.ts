import { z } from "zod";
import { withFounder } from "@/lib/auth";
import { generateStructured, geminiModel } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Tiny structured call with synthetic text — verifies key, model id and JSON-schema output. No candidate data. */
export async function POST() {
  return withFounder(async () => {
    const started = Date.now();
    try {
      const { value, model } = await generateStructured({
        system: "Reply with the requested JSON only.",
        parts: [{ text: 'Return {"ok": true, "echo": "kargo"}.' }],
        jsonSchema: { type: "object", properties: { ok: { type: "boolean" }, echo: { type: "string" } }, required: ["ok", "echo"] },
        validator: z.object({ ok: z.boolean(), echo: z.string() }),
        label: "health check",
        timeoutMs: 25_000,
      });
      return { ok: value.ok, model, ms: Date.now() - started };
    } catch (e) {
      return Response.json({ ok: false, model: geminiModel(), error: (e as Error).message }, { status: 502 });
    }
  });
}
