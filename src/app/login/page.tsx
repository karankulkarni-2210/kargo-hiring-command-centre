import { LoginForm } from "./form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-8 flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-strong">Kargo</div>
            <div className="text-lg font-semibold tracking-tight">Hiring Command Centre</div>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface/90 p-6 shadow-[0_30px_80px_-40px_#4f7dff66]">
          {error === "not_founder" && <p className="mb-4 text-sm text-danger">That account is not authorised for this workspace.</p>}
          {error === "not_configured" && <p className="mb-4 text-sm text-warn">Supabase is not configured on this deployment. Set SUPABASE_URL and SUPABASE_ANON_KEY.</p>}
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs leading-relaxed text-faint">
          Founder-only workspace. Candidate data is protected by row-level security.
          <br />The system recommends; the founder decides.
        </p>
      </div>
    </main>
  );
}

function Logo() {
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
      <rect x="0.5" y="0.5" width="37" height="37" rx="10" fill="#0b0f16" stroke="#283344" />
      <path d="M11 10v18M11 19l9-9M14.5 15.5L24 28" stroke="#6b93ff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="27" cy="11" r="2.4" fill="#33e1d3" />
    </svg>
  );
}
