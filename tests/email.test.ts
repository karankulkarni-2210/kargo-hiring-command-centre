import { describe, expect, it } from "vitest";
import { checkSendEligibility, emailReadiness, readEmailConfig, renderTemplate, validateTemplate, type SendCheckInput } from "@/lib/email/core";

const BASE_ENV = { RESEND_FROM_EMAIL: "squad_8@pg27.mesaschool.co", MESA_TEST_EMAIL: "karan_kulkarni@pg27.mesaschool.co", EMAIL_TEST_MODE: "true" };
const DRAFT = { id: "d1", kind: "invite" as const, version: 2, subject: "Next step for {{role_title}} at {{company_name}}", body: "Hi {{first_name}},\n\nThanks for applying.\n\n{{sender_name}}" };

function input(over: Partial<SendCheckInput> = {}, env: Record<string, string> = { ...BASE_ENV, RESEND_API_KEY: "re_test" }): SendCheckInput {
  return {
    config: readEmailConfig(env),
    decision: { id: "dec1", decision: "advance" },
    draft: DRAFT,
    candidateEmail: "candidate@example.com",
    candidateFirstName: "Asha",
    confirm: { confirmed: true, destinationShown: "karan_kulkarni@pg27.mesaschool.co", draftVersionShown: 2 },
    existing: [],
    ...over,
  };
}

describe("Resend unconfigured (this checkpoint)", () => {
  it("reports 'Email sending is not configured' and blocks every send", () => {
    const cfg = readEmailConfig({ ...BASE_ENV, RESEND_API_KEY: "" });
    expect(emailReadiness(cfg).label).toBe("Email sending is not configured");
    const r = checkSendEligibility(input({}, { ...BASE_ENV, RESEND_API_KEY: "" }));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("not_configured");
  });
});

describe("test mode is the default and routes to MESA_TEST_EMAIL", () => {
  it("defaults to test mode when EMAIL_TEST_MODE is unset or anything but 'false'", () => {
    expect(readEmailConfig({}).testMode).toBe(true);
    expect(readEmailConfig({ EMAIL_TEST_MODE: "True" }).testMode).toBe(true);
    expect(readEmailConfig({ EMAIL_TEST_MODE: "no" }).testMode).toBe(true);
  });
  it("routes to the test inbox, never the candidate", () => {
    const r = checkSendEligibility(input());
    expect(r).toMatchObject({ allowed: true, mode: "test", destination: "karan_kulkarni@pg27.mesaschool.co", intendedRecipient: "candidate@example.com" });
  });
  it("requires a configured MESA test recipient", () => {
    const r = checkSendEligibility(input({}, { ...BASE_ENV, MESA_TEST_EMAIL: "", RESEND_API_KEY: "re_test" }));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("no_test_recipient");
  });
  it("keeps live sending locked unless BOTH flags are set", () => {
    const env = { ...BASE_ENV, EMAIL_TEST_MODE: "false", RESEND_API_KEY: "re_test" };
    const locked = checkSendEligibility(input({ confirm: { confirmed: true, destinationShown: "candidate@example.com", draftVersionShown: 2 } }, env));
    expect(locked.allowed).toBe(false);
    const live = checkSendEligibility(input({ confirm: { confirmed: true, destinationShown: "candidate@example.com", draftVersionShown: 2 } }, { ...env, ALLOW_LIVE_CANDIDATE_EMAILS: "true" }));
    expect(live).toMatchObject({ allowed: true, mode: "live", destination: "candidate@example.com" });
  });
});

describe("human decision boundary", () => {
  it("blocks sending with no recorded decision", () => {
    const r = checkSendEligibility(input({ decision: null }));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("no_decision");
  });
  it("never sends for Hold", () => {
    const r = checkSendEligibility(input({ decision: { id: "x", decision: "hold" } }));
    expect(r.allowed).toBe(false);
  });
  it("requires the draft type to match the decision", () => {
    const r = checkSendEligibility(input({ decision: { id: "x", decision: "decline" } }));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("kind_mismatch");
  });
  it("requires explicit confirmation of the exact destination and draft version", () => {
    expect(checkSendEligibility(input({ confirm: { confirmed: false, destinationShown: "karan_kulkarni@pg27.mesaschool.co", draftVersionShown: 2 } })).allowed).toBe(false);
    const wrongDest = checkSendEligibility(input({ confirm: { confirmed: true, destinationShown: "someone@else.com", draftVersionShown: 2 } }));
    expect(wrongDest.allowed).toBe(false);
    const stale = checkSendEligibility(input({ confirm: { confirmed: true, destinationShown: "karan_kulkarni@pg27.mesaschool.co", draftVersionShown: 1 } }));
    expect(stale.allowed).toBe(false);
  });
  it("prevents duplicate sends but allows retry after a failure", () => {
    const dup = checkSendEligibility(input({ existing: [{ mode: "test", status: "sent", kind: "invite", draftId: "d1", draftVersion: 2 }] }));
    expect(dup.allowed).toBe(false);
    if (!dup.allowed) expect(dup.code).toBe("duplicate");
    const retry = checkSendEligibility(input({ existing: [{ mode: "test", status: "failed", kind: "invite", draftId: "d1", draftVersion: 2 }] }));
    expect(retry.allowed).toBe(true);
  });
});

describe("placeholder templates", () => {
  it("rejects unknown placeholders, raw tokens and embedded addresses", () => {
    expect(validateTemplate("Hi", "Hello {{name}}")).not.toEqual([]);
    expect(validateTemplate("Hi", "Hello [CANDIDATE], {{first_name}}")).not.toEqual([]);
    expect(validateTemplate("Hi", "Hello {{first_name}}, write to a@b.co")).not.toEqual([]);
    expect(validateTemplate(DRAFT.subject, DRAFT.body)).toEqual([]);
  });
  it("substitutes the real name server-side and reports anything unresolved", () => {
    const r = renderTemplate(DRAFT.body, { first_name: "Asha", sender_name: "Arjun" });
    expect(r.text).toContain("Hi Asha,");
    expect(r.unresolved).toEqual([]);
    expect(renderTemplate("{{first_name}} {{role_title}}", { first_name: "A" }).unresolved).toEqual(["role_title"]);
  });
});
