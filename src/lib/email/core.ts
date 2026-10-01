/**
 * Email configuration, template rendering and the send-eligibility guard.
 * Pure (no network) so it can be unit-tested; the Resend call lives in resend.ts and is
 * imported ONLY by the explicit Confirm-to-Send route.
 */

export type EmailConfig = {
  apiKeyConfigured: boolean;
  fromEmail: string | null;
  testMode: boolean;
  testRecipient: string | null;
  liveSendingAllowed: boolean;
  senderName: string;
  companyName: string;
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readEmailConfig(env: Record<string, string | undefined> = process.env): EmailConfig {
  const testRaw = (env.EMAIL_TEST_MODE ?? "true").trim().toLowerCase();
  // Anything other than an explicit "false" keeps test mode ON.
  const testMode = testRaw !== "false";
  const testRecipient = env.MESA_TEST_EMAIL?.trim() || null;
  const fromEmail = env.RESEND_FROM_EMAIL?.trim() || null;
  return {
    apiKeyConfigured: Boolean(env.RESEND_API_KEY?.trim()),
    fromEmail: fromEmail && EMAIL_SHAPE.test(fromEmail) ? fromEmail : null,
    testMode,
    testRecipient: testRecipient && EMAIL_SHAPE.test(testRecipient) ? testRecipient : null,
    liveSendingAllowed: !testMode && (env.ALLOW_LIVE_CANDIDATE_EMAILS ?? "").trim().toLowerCase() === "true",
    senderName: env.EMAIL_SENDER_NAME?.trim() || "Arjun Mehta, Founder, Kargo",
    companyName: "Kargo",
  };
}

export type ReadinessState = { ready: boolean; label: string; detail: string };

export function emailReadiness(c: EmailConfig): ReadinessState {
  if (!c.apiKeyConfigured)
    return { ready: false, label: "Email sending is not configured", detail: "RESEND_API_KEY is not set. Drafts and decisions work; nothing can be sent." };
  if (!c.fromEmail) return { ready: false, label: "Sender address missing", detail: "RESEND_FROM_EMAIL is not set or not a valid address." };
  if (c.testMode && !c.testRecipient)
    return { ready: false, label: "Test recipient missing", detail: "Test mode is on but MESA_TEST_EMAIL is not configured, so test sends are blocked." };
  if (c.testMode) return { ready: true, label: "Test mode", detail: `All emails are routed to ${c.testRecipient}. Candidates are never contacted.` };
  if (!c.liveSendingAllowed)
    return { ready: false, label: "Live sending locked", detail: "EMAIL_TEST_MODE is false but ALLOW_LIVE_CANDIDATE_EMAILS is not 'true'. Sending is blocked." };
  return { ready: true, label: "LIVE — real candidates", detail: "Emails go to candidates' real addresses after explicit confirmation." };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export const PLACEHOLDERS = ["first_name", "role_title", "company_name", "sender_name"] as const;
export type PlaceholderVars = Record<(typeof PLACEHOLDERS)[number], string>;

export function findPlaceholders(t: string): string[] {
  return Array.from(t.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)).map((m) => m[1]);
}

export function validateTemplate(subject: string, body: string): string[] {
  const problems: string[] = [];
  const all = [...findPlaceholders(subject), ...findPlaceholders(body)];
  const unknown = all.filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
  if (unknown.length) problems.push(`Unknown placeholder(s): ${Array.from(new Set(unknown)).map((u) => `{{${u}}}`).join(", ")}`);
  if (!findPlaceholders(body).includes("first_name")) problems.push("Body must greet the candidate with {{first_name}}");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(subject + body)) problems.push("Template must not contain an email address");
  if (/\[(NAME|CANDIDATE|EMAIL|PHONE)\]/i.test(subject + body)) problems.push("Template contains a raw redaction token; use {{first_name}}");
  return problems;
}

export function renderTemplate(t: string, vars: Partial<PlaceholderVars>): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = t.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (m, k: string) => {
    const v = (vars as Record<string, string | undefined>)[k];
    if (v === undefined || v === null || v.trim() === "") {
      unresolved.push(k);
      return m;
    }
    return v;
  });
  return { text, unresolved };
}

// ---------------------------------------------------------------------------
// Send guard — the human decision boundary
// ---------------------------------------------------------------------------
export type Decision = "advance" | "hold" | "decline";
export const DECISION_TO_KIND: Record<Decision, "invite" | "rejection" | null> = { advance: "invite", decline: "rejection", hold: null };

export type SendCheckInput = {
  config: EmailConfig;
  decision: { id: string; decision: Decision } | null;
  draft: { id: string; kind: "invite" | "rejection"; version: number; subject: string; body: string } | null;
  candidateEmail: string | null;
  candidateFirstName: string | null;
  confirm: { confirmed: boolean; destinationShown: string | null; draftVersionShown: number | null };
  existing: { mode: "test" | "live"; status: "sending" | "sent" | "failed"; kind: string; draftId: string; draftVersion: number }[];
};

export type SendCheckResult =
  | { allowed: true; mode: "test" | "live"; destination: string; intendedRecipient: string | null }
  | { allowed: false; code: string; reasons: string[]; destination: string | null };

export function resolveDestination(config: EmailConfig, candidateEmail: string | null): { mode: "test" | "live"; destination: string | null } {
  if (config.testMode) return { mode: "test", destination: config.testRecipient };
  return { mode: "live", destination: config.liveSendingAllowed ? candidateEmail : null };
}

export function checkSendEligibility(i: SendCheckInput): SendCheckResult {
  const { mode, destination } = resolveDestination(i.config, i.candidateEmail);
  const fail = (code: string, ...reasons: string[]): SendCheckResult => ({ allowed: false, code, reasons, destination });

  if (!i.config.apiKeyConfigured) return fail("not_configured", "Email sending is not configured (RESEND_API_KEY missing).");
  if (!i.config.fromEmail) return fail("no_sender", "RESEND_FROM_EMAIL is missing or invalid.");
  if (mode === "test" && !i.config.testRecipient) return fail("no_test_recipient", "Test mode requires MESA_TEST_EMAIL before any send.");
  if (mode === "live" && !i.config.liveSendingAllowed) return fail("live_locked", "Live candidate sending is not enabled.");
  if (!i.decision) return fail("no_decision", "Record a founder decision (Advance / Hold / Decline) before sending.");
  const kind = DECISION_TO_KIND[i.decision.decision];
  if (!kind) return fail("hold_no_email", "Decision is Hold — no email is sent for Hold.");
  if (!i.draft) return fail("no_draft", `No ${kind} draft exists yet.`);
  if (i.draft.kind !== kind) return fail("kind_mismatch", `Decision ${i.decision.decision} requires an ${kind} email; this draft is ${i.draft.kind}.`);
  const problems = validateTemplate(i.draft.subject, i.draft.body);
  if (problems.length) return fail("template_invalid", ...problems);
  if (!i.candidateFirstName) return fail("no_name", "Candidate name was not extracted; the greeting cannot be personalised.");
  if (mode === "live" && !i.candidateEmail) return fail("no_candidate_email", "Candidate email address was not extracted.");
  if (!destination) return fail("no_destination", "No destination address could be resolved.");
  if (!i.confirm.confirmed) return fail("not_confirmed", "Explicit Confirm to Send is required.");
  if (i.confirm.destinationShown?.toLowerCase() !== destination.toLowerCase())
    return fail("destination_changed", "The destination shown to you no longer matches the configured destination. Reload and review.");
  if (i.confirm.draftVersionShown !== i.draft.version)
    return fail("draft_changed", "The draft changed after you reviewed it. Reload and review again.");

  const dup = i.existing.find((s) =>
    s.status !== "failed" &&
    (mode === "live" ? s.mode === "live" && s.kind === kind : s.mode === "test" && s.draftId === i.draft!.id && s.draftVersion === i.draft!.version),
  );
  if (dup) return fail("duplicate", dup.status === "sending" ? "A send for this email is already in progress." : "This email has already been sent.");

  return { allowed: true, mode, destination, intendedRecipient: mode === "test" ? i.candidateEmail : null };
}

export function testModeBanner(intended: string | null, candidateName: string | null): string {
  return (
    "[TEST MODE — Kargo Hiring Command Centre]\n" +
    `This email was routed to the MESA test inbox. Intended recipient: ${candidateName ?? "(name not extracted)"} <${intended ?? "no address extracted"}>.\n` +
    "No candidate has been contacted.\n" +
    "------------------------------------------------------------\n\n"
  );
}
