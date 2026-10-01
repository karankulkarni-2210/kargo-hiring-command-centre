/**
 * Identifier separation and redaction.
 *
 * Data path:
 *  1. preRedactContacts() runs locally on the raw CV text BEFORE any AI call: emails, phone
 *     numbers and URLs are captured into restricted fields and replaced with tokens.
 *  2. The extraction call (Gemini) still receives the candidate's name, location and any other
 *     personal details written in the CV — it is NOT anonymous. For scanned PDFs it receives the
 *     original file, including contact details.
 *  3. redactIdentity() removes the extracted name, header location and sensitive personal lines.
 *  4. Only the output of step 3 is stored as redacted_text and passed to scoring, brief and
 *     email-drafting calls. residualIdentifierCheck() is run before each of those calls.
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:linkedin\.com|github\.com|behance\.net|medium\.com|twitter\.com|x\.com)\/[^\s<>()]+/gi;
const PHONE_CANDIDATE_RE = /(?<![\w/])(\+?\(?\d[\d\s().-]{7,18}\d)(?![\w/])/g;

export type ContactCapture = { emails: string[]; phones: string[]; links: string[] };

function isYearLike(groups: string[]): boolean {
  return groups.length > 0 && groups.every((g) => /^(19|20)\d\d$/.test(g) || /^\d{1,2}$/.test(g));
}

export function looksLikePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return false;
  const groups = raw.split(/\D+/).filter(Boolean);
  if (isYearLike(groups)) return false; // e.g. "2019 - 2023 2024"
  return true;
}

export function preRedactContacts(text: string): { text: string; captured: ContactCapture } {
  const captured: ContactCapture = { emails: [], phones: [], links: [] };
  let out = text.replace(EMAIL_RE, (m) => {
    captured.emails.push(m);
    return "[EMAIL]";
  });
  out = out.replace(URL_RE, (m) => {
    captured.links.push(m.replace(/[.,;:]+$/, ""));
    return "[LINK]";
  });
  out = out.replace(PHONE_CANDIDATE_RE, (m) => {
    if (!looksLikePhone(m)) return m;
    captured.phones.push(m.trim());
    return "[PHONE]";
  });
  captured.emails = Array.from(new Set(captured.emails.map((e) => e.toLowerCase())));
  captured.phones = Array.from(new Set(captured.phones));
  captured.links = Array.from(new Set(captured.links));
  return { text: out, captured };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function nameTokens(fullName: string | null | undefined): string[] {
  if (!fullName) return [];
  return Array.from(
    new Set(
      fullName
        .split(/[\s,.'-]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !/^(mr|mrs|ms|dr|miss)$/i.test(t)),
    ),
  );
}

export type IdentityForRedaction = {
  fullName: string | null;
  locationText: string | null;
  sensitiveLines: string[];
  emails?: string[];
  phones?: string[];
};

export type RedactionReport = {
  nameReplacements: number;
  locationReplacements: number;
  sensitiveLineReplacements: number;
  contactTokens: number;
  residual: string[];
};

const SENSITIVE_LINE_RE =
  /^.*(?:\b(?:date of birth|d\.o\.b|dob|birth ?date|marital status|religion|caste|nationality|father'?s name|mother'?s name|husband'?s name|passport (?:no|number))\b|\b(?:age|gender|sex)\s*[:\-]).*$/gim;

export function redactIdentity(text: string, id: IdentityForRedaction): { text: string; report: RedactionReport } {
  let out = text;
  let nameReplacements = 0;
  let locationReplacements = 0;
  let sensitiveLineReplacements = 0;

  for (const line of id.sensitiveLines ?? []) {
    const l = line.trim();
    if (l.length < 4) continue;
    const re = new RegExp(escapeRe(l), "gi");
    out = out.replace(re, () => {
      sensitiveLineReplacements++;
      return "[REDACTED PERSONAL DETAIL]";
    });
  }
  out = out.replace(SENSITIVE_LINE_RE, () => {
    sensitiveLineReplacements++;
    return "[REDACTED PERSONAL DETAIL]";
  });

  if (id.fullName && id.fullName.trim().length >= 3) {
    const full = new RegExp(escapeRe(id.fullName.trim()).replace(/\\?\s+/g, "\\s+"), "gi");
    out = out.replace(full, () => {
      nameReplacements++;
      return "[CANDIDATE]";
    });
    for (const tok of nameTokens(id.fullName)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(tok)}(?![\\p{L}\\p{N}])`, "giu");
      out = out.replace(re, () => {
        nameReplacements++;
        return "[CANDIDATE]";
      });
    }
    out = out.replace(/\[CANDIDATE\](?:\s*\[CANDIDATE\])+/g, "[CANDIDATE]");
  }

  if (id.locationText && id.locationText.trim().length >= 3) {
    const re = new RegExp(escapeRe(id.locationText.trim()), "gi");
    out = out.replace(re, () => {
      locationReplacements++;
      return "[LOCATION]";
    });
  }

  // Belt and braces: re-run contact redaction on the result.
  const again = preRedactContacts(out);
  out = again.text;
  for (const e of id.emails ?? []) out = out.replace(new RegExp(escapeRe(e), "gi"), "[EMAIL]");
  for (const p of id.phones ?? []) out = out.replace(new RegExp(escapeRe(p), "g"), "[PHONE]");

  const contactTokens = (out.match(/\[(EMAIL|PHONE|LINK)\]/g) ?? []).length;
  const residual = residualIdentifierCheck(out, id);
  return { text: out, report: { nameReplacements, locationReplacements, sensitiveLineReplacements, contactTokens, residual } };
}

/** Returns a list of identifier kinds still present. Empty list = safe to pass downstream. */
export function residualIdentifierCheck(text: string, id: Pick<IdentityForRedaction, "fullName" | "emails" | "phones">): string[] {
  const found: string[] = [];
  if (new RegExp(EMAIL_RE.source, "i").test(text)) found.push("email");
  const phoneMatches = text.match(PHONE_CANDIDATE_RE) ?? [];
  if (phoneMatches.some(looksLikePhone)) found.push("phone");
  for (const tok of nameTokens(id.fullName)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(tok)}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) {
      found.push(`name:${tok.length}ch`);
      break;
    }
  }
  for (const e of id.emails ?? []) if (text.toLowerCase().includes(e.toLowerCase())) found.push("known-email");
  return Array.from(new Set(found));
}

/** Hard gate used immediately before any downstream AI call. */
export function assertRedacted(text: string, id: Pick<IdentityForRedaction, "fullName" | "emails" | "phones">): void {
  const residual = residualIdentifierCheck(text, id);
  if (residual.length) throw new Error(`Redaction gate blocked AI call: residual identifiers (${residual.join(", ")})`);
}

const INJECTION_PATTERNS: [string, RegExp][] = [
  ["ignore-instructions", /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all|any)\b.{0,30}\b(instructions?|rules|prompts?)\b/i],
  ["role-hijack", /\byou are (now )?(an?|the) (ai|assistant|language model|recruiter|hiring (manager|system))\b/i],
  ["score-manipulation", /\b(give|assign|rate|score)\b.{0,30}\b(this|the|me|candidate)\b.{0,30}\b(5|five|highest|maximum|top|100)\b/i],
  ["system-prompt", /\b(system prompt|developer message|<\/?system>|\[\/?INST\])/i],
  ["hidden-directive", /\b(note to (ai|llm|the model)|ai reviewers?:)/i],
];

export function detectInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
}

/** Wrap untrusted CV content so it cannot close our delimiter. */
export function wrapUntrusted(tag: string, text: string): string {
  const safe = text.replace(new RegExp(`</?\\s*${tag}\\s*>`, "gi"), "[removed-tag]");
  return `<${tag}>\n${safe}\n</${tag}>`;
}
