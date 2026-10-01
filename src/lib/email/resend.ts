import "server-only";

/**
 * Resend transport. Imported only by the explicit Confirm-to-Send route and the Settings
 * integration test route (enforced by tests/email-boundary.test.ts).
 * Never reports success unless Resend returns a message id.
 */
export class ResendSendError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export async function sendViaResend(p: {
  from: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  replyTo?: string;
}): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new ResendSendError("Email sending is not configured");
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": p.idempotencyKey,
      },
      body: JSON.stringify({ from: p.from, to: [p.to], subject: p.subject, text: p.text, ...(p.replyTo ? { reply_to: p.replyTo } : {}) }),
      cache: "no-store",
    });
  } catch (e) {
    throw new ResendSendError(`Network error contacting Resend: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !json.id) throw new ResendSendError(`Resend ${res.status}: ${json.message ?? json.name ?? "no message id returned"}`, res.status);
  return { id: json.id };
}
