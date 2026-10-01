import { requireFounderPage } from "@/lib/auth";
import { emailReadiness, readEmailConfig } from "@/lib/email/core";
import { geminiModel, DEFAULT_GEMINI_MODEL } from "@/lib/ai/gemini";
import { serviceRoleConfigured } from "@/lib/env";
import { Badge, Card, Notice } from "@/components/ui";
import { GeminiCheck, TestEmail } from "./client";

export const dynamic = "force-dynamic";

async function timedCount(supabase: Awaited<ReturnType<typeof requireFounderPage>>["supabase"]) {
  const started = performance.now();
  const { count, error } = await supabase.from("candidates").select("id", { count: "exact", head: true });
  return { count, error, dbMs: Math.round(performance.now() - started) };
}

function mask(email: string | null) {
  if (!email) return "—";
  const [u, d] = email.split("@");
  return `${u.slice(0, 3)}…@${d}`;
}

export default async function SettingsPage() {
  const { supabase } = await requireFounderPage();
  const { count, error, dbMs } = await timedCount(supabase);
  const { data: rubric } = await supabase.from("rubric_versions").select("version_label").eq("is_active", true).maybeSingle();
  const email = readEmailConfig();
  const ready = emailReadiness(email);
  const geminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  const cron = Boolean(process.env.CRON_SECRET?.trim()) && serviceRoleConfigured();

  const rows: { name: string; ok: boolean; state: string; detail: string }[] = [
    { name: "Supabase database", ok: !error, state: error ? "Error" : "Connected", detail: error ? error.message : `Live query OK (${dbMs} ms) · ${count ?? 0} candidate rows · RLS enforced as founder` },
    { name: "Rubric", ok: Boolean(rubric), state: rubric ? `v${rubric.version_label} active` : "None active", detail: "Stored source + parsed version in rubric_versions" },
    { name: "Gemini", ok: geminiKey, state: geminiKey ? "Key configured" : "Not configured", detail: `Model: ${geminiModel()}${geminiModel() === DEFAULT_GEMINI_MODEL ? " (default)" : " (GEMINI_MODEL)"} · thinking level ${process.env.GEMINI_THINKING_LEVEL || "low"}` },
    { name: "Resend", ok: email.apiKeyConfigured, state: email.apiKeyConfigured ? "Key configured" : "Email sending is not configured", detail: email.apiKeyConfigured ? `From ${email.fromEmail ?? "— (RESEND_FROM_EMAIL missing)"}` : "RESEND_API_KEY is blank. Nothing can be sent; no send is ever simulated." },
    { name: "Background fallback (Vercel Cron)", ok: cron, state: cron ? "Enabled" : "Off", detail: cron ? "Daily drain of the queue without a browser open" : "Optional: set SUPABASE_SERVICE_ROLE_KEY + CRON_SECRET. Processing runs while the app is open regardless." },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Integration readiness. Secrets are read on the server and never displayed.</p>
      </div>

      <Card title="Integrations">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.name} className="flex flex-wrap items-center gap-3 py-3">
              <span className={`h-2 w-2 rounded-full ${r.ok ? "bg-ok" : "bg-danger"}`} />
              <span className="w-56 text-sm font-medium">{r.name}</span>
              <Badge tone={r.ok ? "ok" : "danger"}>{r.state}</Badge>
              <span className="text-xs text-muted">{r.detail}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-line pt-4">
          <GeminiCheck disabled={!geminiKey} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Email mode" subtitle="Test mode is the default. Live candidate sending needs two explicit settings.">
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">EMAIL_TEST_MODE</dt><dd>{email.testMode ? <Badge tone="cyan">ON — all mail to test inbox</Badge> : <Badge tone="danger">OFF</Badge>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">MESA_TEST_EMAIL</dt><dd className="font-mono text-xs">{email.testRecipient ? mask(email.testRecipient) : <span className="text-danger">not set — test sends blocked</span>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">RESEND_FROM_EMAIL</dt><dd className="font-mono text-xs">{email.fromEmail ?? <span className="text-danger">not set</span>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">ALLOW_LIVE_CANDIDATE_EMAILS</dt><dd>{email.liveSendingAllowed ? <Badge tone="danger">enabled</Badge> : <Badge>locked</Badge>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Sender signature</dt><dd className="text-xs">{email.senderName}</dd></div>
          </dl>
          <div className="mt-4">
            <Notice tone={ready.ready ? (email.testMode ? "cyan" : "danger") : "danger"} title={ready.label}>{ready.detail}</Notice>
          </div>
          <div className="mt-4">
            <TestEmail enabled={ready.ready && email.testMode} destination={email.testRecipient} />
          </div>
        </Card>

        <Card title="Data path (for your evaluator)" subtitle="Accurate description of what each AI call receives">
          <ol className="space-y-2.5 text-[13px] leading-relaxed text-muted">
            <li><span className="text-text">Upload →</span> original file stored in a private Supabase bucket (founder-only RLS).</li>
            <li><span className="text-text">Local pre-redaction →</span> emails, phone numbers and URLs are captured to restricted fields and replaced before any AI call.</li>
            <li><span className="text-text">Gemini extraction →</span> receives the remaining CV text <em>including the name and location</em>, or the original PDF for scanned files. This step is <em>not</em> anonymous.</li>
            <li><span className="text-text">Redaction →</span> name, header location and personal lines (DOB, gender, marital status…) replaced; a residual-identifier gate blocks the next steps if anything remains.</li>
            <li><span className="text-text">Scoring, briefs, drafts →</span> receive only redacted evidence plus a city-level location signal for the in-office requirement. Drafts use placeholders; the real name is substituted on the server at preview/send.</li>
            <li><span className="text-text">Free vs billed Gemini →</span> on the free tier Google may use inputs to improve its products; a billed key does not. Use a billed key for real candidate data.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
