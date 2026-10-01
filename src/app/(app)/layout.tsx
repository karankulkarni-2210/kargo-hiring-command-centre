import { requireFounderPage } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { ProcessingDriver } from "@/components/processing-driver";
import { Badge } from "@/components/ui";
import Link from "next/link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, email } = await requireFounderPage();
  const { data: rubric } = await supabase.from("rubric_versions").select("version_label, declared_status").eq("is_active", true).maybeSingle();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface/60 backdrop-blur md:flex">
        <div className="flex items-center gap-2.5 px-5 pb-6 pt-5">
          <svg width="30" height="30" viewBox="0 0 38 38" aria-hidden>
            <rect x="0.5" y="0.5" width="37" height="37" rx="10" fill="#0b0f16" stroke="#283344" />
            <path d="M11 10v18M11 19l9-9M14.5 15.5L24 28" stroke="#6b93ff" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="27" cy="11" r="2.4" fill="#33e1d3" />
          </svg>
          <div className="leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent-strong">Kargo</div>
            <div className="text-[13px] font-semibold tracking-tight">Hiring Command Centre</div>
          </div>
        </div>
        <Nav />
        <div className="mt-auto space-y-3 border-t border-line p-4">
          <Link href="/rubric" className="block rounded-lg border border-line bg-surface-2 p-3 hover:border-warn/50">
            <div className="text-[10px] uppercase tracking-[0.14em] text-faint">Active rubric</div>
            {rubric ? (
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-sm">v{rubric.version_label}</span>
                <Badge tone={/PROVISIONAL/i.test(rubric.declared_status) ? "warn" : "ok"}>{rubric.declared_status}</Badge>
              </div>
            ) : (
              <div className="mt-1 text-sm text-danger">None active</div>
            )}
          </Link>
          <div className="truncate text-xs text-muted" title={email}>{email}</div>
          <form action="/api/auth/logout" method="post">
            <button className="text-xs text-faint hover:text-text">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line bg-bg/80 px-5 backdrop-blur md:px-8">
          <div className="flex items-center gap-3 md:hidden">
            <span className="text-sm font-semibold">Kargo HCC</span>
          </div>
          <div className="hidden text-xs text-faint md:block">The system recommends. <span className="text-text">You decide.</span> Nothing is sent without your explicit confirmation.</div>
          <ProcessingDriver />
        </header>
        <div className="border-b border-line md:hidden">
          <Nav horizontal />
        </div>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-7 md:px-8">{children}</main>
      </div>
    </div>
  );
}
