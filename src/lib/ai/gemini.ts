import "server-only";
import type { z } from "zod";

/**
 * Minimal Gemini REST client with structured (JSON-schema) output, zod validation,
 * one repair round-trip for malformed output, and typed rate-limit errors.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export function geminiModel(): string {
  return (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
}

export class GeminiConfigError extends Error {}
export class GeminiRateLimitError extends Error {
  constructor(message: string, public retryAfterSec: number) {
    super(message);
  }
}
export class GeminiMalformedError extends Error {
  constructor(message: string, public rawText: string) {
    super(message);
  }
}
export class GeminiError extends Error {
  constructor(message: string, public status?: number, public retryable = true) {
    super(message);
  }
}

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

type CallOpts<T> = {
  system: string;
  parts: GeminiPart[];
  jsonSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
  label: string;
  timeoutMs?: number;
};

function parseRetryDelay(body: unknown): number {
  try {
    const details = (body as { error?: { details?: { "@type"?: string; retryDelay?: string }[] } })?.error?.details ?? [];
    for (const d of details) {
      if (d.retryDelay) {
        const s = parseFloat(d.retryDelay);
        if (Number.isFinite(s)) return Math.ceil(s) + 1;
      }
    }
  } catch {
    /* ignore */
  }
  return 30;
}

async function rawCall(body: Record<string, unknown>, timeoutMs: number): Promise<{ text: string; finishReason?: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new GeminiConfigError("GEMINI_API_KEY is not configured");
  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new GeminiError(`Gemini request failed: ${(e as Error).name === "AbortError" ? "timeout" : (e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 429) throw new GeminiRateLimitError("Gemini rate limit / quota reached", parseRetryDelay(json));
  if (res.status === 401 || res.status === 403)
    throw new GeminiError(`Gemini rejected the API key (${res.status})`, res.status, false);
  if (res.status === 404) throw new GeminiError(`Gemini model "${model}" not found — check GEMINI_MODEL`, 404, false);
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new GeminiError(`Gemini ${res.status}: ${msg}`, res.status, res.status >= 500);
  }
  const cand = (json as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] }).candidates?.[0];
  const block = (json as { promptFeedback?: { blockReason?: string } }).promptFeedback?.blockReason;
  if (block) throw new GeminiError(`Gemini blocked the prompt: ${block}`, 400, false);
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  return { text, finishReason: cand?.finishReason };
}

function buildBody(opts: CallOpts<unknown>, extraUserText?: string, withThinking = true) {
  const level = process.env.GEMINI_THINKING_LEVEL?.trim() || "low";
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseJsonSchema: opts.jsonSchema,
    maxOutputTokens: 8192,
  };
  if (withThinking && level !== "off") generationConfig.thinkingConfig = { thinkingLevel: level };
  const parts = extraUserText ? [...opts.parts, { text: extraUserText }] : opts.parts;
  return {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts }],
    generationConfig,
  };
}

function tryParse<T>(text: string, validator: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let data: unknown;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    data = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${(e as Error).message}` };
  }
  const r = validator.safeParse(data);
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, value: r.data };
}

/** Structured call: schema-constrained JSON, validated; one repair attempt if malformed. */
export async function generateStructured<T>(opts: CallOpts<T>): Promise<{ value: T; model: string }> {
  const timeoutMs = opts.timeoutMs ?? 55_000;
  let withThinking = true;
  let first: { text: string; finishReason?: string };
  try {
    first = await rawCall(buildBody(opts as CallOpts<unknown>, undefined, withThinking), timeoutMs);
  } catch (e) {
    // Some models reject thinkingConfig; retry once without it.
    if (e instanceof GeminiError && e.status === 400 && /thinking/i.test(e.message)) {
      withThinking = false;
      first = await rawCall(buildBody(opts as CallOpts<unknown>, undefined, false), timeoutMs);
    } else throw e;
  }
  const p1 = tryParse(first.text, opts.validator);
  if (p1.ok) return { value: p1.value, model: geminiModel() };

  const repair = `Your previous response for "${opts.label}" was rejected by the validator (${p1.error}${
    first.finishReason && first.finishReason !== "STOP" ? `; finishReason=${first.finishReason}` : ""
  }). Return ONLY a single JSON object that satisfies the response schema. Do not add commentary.`;
  const second = await rawCall(buildBody(opts as CallOpts<unknown>, repair, withThinking), timeoutMs);
  const p2 = tryParse(second.text, opts.validator);
  if (p2.ok) return { value: p2.value, model: geminiModel() };
  throw new GeminiMalformedError(`Malformed ${opts.label} output after repair: ${p2.error}`, second.text.slice(0, 2000));
}
