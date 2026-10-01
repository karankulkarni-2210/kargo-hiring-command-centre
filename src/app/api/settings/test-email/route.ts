import { z } from "zod";
import { HttpError, withFounder } from "@/lib/auth";
import { emailReadiness, readEmailConfig } from "@/lib/email/core";
import { sendViaResend } from "@/lib/email/resend";

export const runtime = "nodejs";

const Body = z.object({ confirm: z.literal(true), destinationShown: z.string().min(3) });

/** Integration check only: sends a fixed, non-candidate message to the MESA test inbox, in test mode. */
export async function POST(req: Request) {
  return withFounder(async ({ supabase, email }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Explicit confirmation required.");
    const c = readEmailConfig();
    const r = emailReadiness(c);
    if (!c.testMode) throw new HttpError(409, "The integration test is only available in test mode.");
    if (!r.ready) throw new HttpError(503, r.label + ": " + r.detail);
    if (parsed.data.destinationShown.toLowerCase() !== c.testRecipient!.toLowerCase()) throw new HttpError(409, "Destination changed — reload.");
    try {
      const { id } = await sendViaResend({
        from: c.fromEmail!,
        to: c.testRecipient!,
        subject: "[TEST] Kargo Hiring Command Centre — Resend integration check",
        text: `This is an integration test from Kargo Hiring Command Centre, confirmed by ${email} at ${new Date().toISOString()}.\nNo candidate was contacted.`,
        idempotencyKey: `settings-test-${Date.now()}`,
      });
      await supabase.from("audit_log").insert({ actor: email, action: "integration_test_email_sent", entity: "settings", details: { provider_message_id: id, to: c.testRecipient } });
      return { status: "sent", providerMessageId: id, to: c.testRecipient };
    } catch (e) {
      await supabase.from("audit_log").insert({ actor: email, action: "integration_test_email_failed", entity: "settings", details: { error: (e as Error).message } });
      throw new HttpError(502, (e as Error).message);
    }
  });
}
