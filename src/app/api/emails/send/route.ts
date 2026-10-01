import { z } from "zod";
import { HttpError, withFounder } from "@/lib/auth";
import { checkSendEligibility, readEmailConfig, renderTemplate, testModeBanner, type Decision } from "@/lib/email/core";
import { sendViaResend } from "@/lib/email/resend";
import { ROLE_TITLES, type Role } from "@/lib/rubric/types";

export const runtime = "nodejs";

const Body = z.object({
  candidateId: z.string().uuid(),
  draftId: z.string().uuid(),
  draftVersionShown: z.number().int(),
  destinationShown: z.string().min(3),
  confirm: z.literal(true),
});

/**
 * THE ONLY PATH THAT CONTACTS ANYONE. Requires: founder session, a recorded Advance/Decline
 * decision matching the draft type, an explicit confirmation echoing the destination and draft
 * version the founder reviewed, and a configured Resend key. Test mode routes to MESA_TEST_EMAIL.
 */
export async function POST(req: Request) {
  return withFounder(async ({ supabase, email }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Explicit confirmation is required (confirm: true, with the destination and draft version you reviewed).");
    const b = parsed.data;
    const config = readEmailConfig();

    const [{ data: cand }, { data: draft }, { data: ident }, { data: decisions }, { data: existing }] = await Promise.all([
      supabase.from("candidates").select("id, applied_role").eq("id", b.candidateId).maybeSingle(),
      supabase.from("email_drafts").select("*").eq("id", b.draftId).eq("candidate_id", b.candidateId).eq("is_current", true).maybeSingle(),
      supabase.from("candidate_identities").select("full_name, first_name, email").eq("candidate_id", b.candidateId).maybeSingle(),
      supabase.from("decisions").select("id, decision").eq("candidate_id", b.candidateId).order("decided_at", { ascending: false }).limit(1),
      supabase.from("email_sends").select("mode, status, kind, draft_id, draft_version").eq("candidate_id", b.candidateId),
    ]);
    if (!cand) throw new HttpError(404, "Candidate not found");
    const decision = decisions?.[0] ? { id: decisions[0].id as string, decision: decisions[0].decision as Decision } : null;

    const check = checkSendEligibility({
      config,
      decision,
      draft: draft ? { id: draft.id, kind: draft.kind, version: draft.version, subject: draft.subject_template, body: draft.body_template } : null,
      candidateEmail: ident?.email ?? null,
      candidateFirstName: ident?.first_name ?? null,
      confirm: { confirmed: b.confirm, destinationShown: b.destinationShown, draftVersionShown: b.draftVersionShown },
      existing: (existing ?? []).map((s) => ({ mode: s.mode, status: s.status, kind: s.kind, draftId: s.draft_id, draftVersion: s.draft_version })),
    });
    if (!check.allowed) {
      const status = check.code === "not_configured" || check.code === "no_sender" || check.code === "no_test_recipient" || check.code === "live_locked" ? 503 : check.code === "duplicate" ? 409 : 422;
      throw new HttpError(status, check.reasons.join(" "), { code: check.code });
    }

    const vars = { first_name: ident!.first_name!, role_title: ROLE_TITLES[cand.applied_role as Role], company_name: config.companyName, sender_name: config.senderName };
    const subject = renderTemplate(draft!.subject_template, vars);
    const body = renderTemplate(draft!.body_template, vars);
    if (subject.unresolved.length || body.unresolved.length) throw new HttpError(422, `Unresolved placeholders: ${[...subject.unresolved, ...body.unresolved].join(", ")}`);
    const finalSubject = check.mode === "test" ? `[TEST] ${subject.text}` : subject.text;
    const finalBody = check.mode === "test" ? testModeBanner(check.intendedRecipient, ident?.full_name ?? null) + body.text : body.text;

    // Claim the send first; the partial unique index makes a concurrent duplicate fail here.
    const { data: row, error: claimErr } = await supabase
      .from("email_sends")
      .insert({
        candidate_id: b.candidateId,
        draft_id: draft!.id,
        draft_version: draft!.version,
        decision_id: decision!.id,
        kind: draft!.kind,
        mode: check.mode,
        to_email: check.destination,
        intended_recipient_email: check.intendedRecipient,
        subject_rendered: finalSubject,
        status: "sending",
        confirmed_by_email: email,
      })
      .select()
      .single();
    if (claimErr) throw new HttpError(claimErr.code === "23505" ? 409 : 500, claimErr.code === "23505" ? "This email has already been sent or is being sent." : claimErr.message);

    try {
      const { id: providerId } = await sendViaResend({ from: config.fromEmail!, to: check.destination, subject: finalSubject, text: finalBody, idempotencyKey: row.id });
      await supabase.from("email_sends").update({ status: "sent", provider_message_id: providerId, completed_at: new Date().toISOString() }).eq("id", row.id);
      await supabase.from("audit_log").insert({ actor: email, action: "email_sent", entity: "email_send", entity_id: row.id, details: { mode: check.mode, provider_message_id: providerId } });
      return { status: "sent", mode: check.mode, to: check.destination, providerMessageId: providerId, sendId: row.id };
    } catch (e) {
      const msg = (e as Error).message;
      await supabase.from("email_sends").update({ status: "failed", error: msg, completed_at: new Date().toISOString() }).eq("id", row.id);
      await supabase.from("audit_log").insert({ actor: email, action: "email_failed", entity: "email_send", entity_id: row.id, details: { error: msg } });
      throw new HttpError(502, `Send failed: ${msg}`, { sendId: row.id });
    }
  });
}
