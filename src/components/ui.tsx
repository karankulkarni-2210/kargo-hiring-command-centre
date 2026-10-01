import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className, title, action, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface/80 backdrop-blur-sm animate-rise", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-[13px] font-semibold tracking-wide text-text">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "cyan";
const TONES: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-3 text-muted",
  accent: "border-accent/40 bg-accent/10 text-accent-strong",
  ok: "border-ok/35 bg-ok/10 text-ok",
  warn: "border-warn/35 bg-warn/10 text-warn",
  danger: "border-danger/35 bg-danger/10 text-danger",
  cyan: "border-cyan/35 bg-cyan/10 text-cyan",
};

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-surface/80 px-4 py-3.5 animate-rise">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={cx("mt-1.5 font-mono text-2xl font-semibold tabular-nums", tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : tone === "accent" ? "text-accent-strong" : "text-text")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Score with evidence coverage always shown beside it (rubric 6.2: "always both"). */
export function ScoreCoverage({ score, coverage, interpretable, compact, minimum = 70 }: { score: number | null; coverage: number; interpretable: boolean; compact?: boolean; minimum?: number }) {
  const pct = Math.max(0, Math.min(100, coverage));
  return (
    <div className={cx("flex items-center gap-3", compact ? "min-w-[150px]" : "min-w-[190px]")}>
      <div className="w-14 text-right">
        <div className={cx("font-mono text-lg font-semibold tabular-nums leading-none", score === null ? "text-faint" : interpretable ? "text-text" : "text-muted")}>
          {score === null ? "—" : score.toFixed(1)}
        </div>
        {!compact && <div className="mt-1 text-[10px] uppercase tracking-wider text-faint">/100</div>}
      </div>
      <div className="flex-1">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", interpretable ? "bg-accent" : "bg-warn/70")} style={{ width: `${pct}%` }} />
          <div className="absolute inset-y-0 w-px bg-text/40" style={{ left: `${minimum}%` }} title={`${minimum}% interpretation minimum`} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-muted tabular-nums">
          <span>{Number.isInteger(coverage) ? coverage : coverage.toFixed(1)}% coverage</span>
          {!interpretable && score !== null && <span className="text-warn">not interpretable</span>}
        </div>
      </div>
    </div>
  );
}

export function ButtonLink({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: "primary" | "ghost" | "outline"; className?: string }) {
  return (
    <Link href={href} className={cx(buttonClass(variant), className)}>
      {children}
    </Link>
  );
}

export function buttonClass(variant: "primary" | "ghost" | "outline" | "danger" = "primary") {
  const base = "focus-ring inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  if (variant === "primary") return `${base} bg-accent text-white hover:bg-accent-strong shadow-[0_0_0_1px_#6b93ff55,0_8px_24px_-12px_#4f7dff]`;
  if (variant === "danger") return `${base} bg-danger/90 text-white hover:bg-danger`;
  if (variant === "outline") return `${base} border border-line-strong bg-surface-2 text-text hover:border-accent/60`;
  return `${base} text-muted hover:bg-surface-3 hover:text-text`;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid-texture rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      <div className="text-sm font-medium text-text">{title}</div>
      {children && <div className="mt-1.5 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "warn", title, children }: { tone?: Tone; title: ReactNode; children?: ReactNode }) {
  const border = tone === "danger" ? "border-danger/40" : tone === "ok" ? "border-ok/40" : tone === "accent" ? "border-accent/40" : tone === "cyan" ? "border-cyan/40" : "border-warn/40";
  const dot = tone === "danger" ? "bg-danger" : tone === "ok" ? "bg-ok" : tone === "accent" ? "bg-accent" : tone === "cyan" ? "bg-cyan" : "bg-warn";
  return (
    <div className={cx("rounded-xl border bg-surface/80 px-4 py-3 animate-rise", border)}>
      <div className="flex items-start gap-2.5">
        <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
        <div className="min-w-0">
          <div className="text-sm font-medium text-text">{title}</div>
          {children && <div className="mt-1 text-[13px] leading-relaxed text-muted">{children}</div>}
        </div>
      </div>
    </div>
  );
}

export const DECISION_TONE: Record<string, Tone> = { advance: "ok", hold: "warn", decline: "danger" };
export const DECISION_LABEL: Record<string, string> = { advance: "Advance", hold: "Hold", decline: "Decline" };

export function recTone(rec: string): Tone {
  if (rec.startsWith("Human review: advance")) return "accent";
  if (rec.startsWith("Hold")) return "warn";
  if (rec.startsWith("Human review: contradictions")) return "danger";
  return "neutral";
}

export function TierBadge({ tier }: { tier: string | null }) {
  if (tier === "interpretable") return <Badge tone="accent" title="Coverage ≥ 70%: total can be interpreted">≥70% coverage</Badge>;
  if (tier === "low_coverage") return <Badge tone="warn" title="Coverage < 70%: ranked by coverage, score not interpreted">Low coverage</Badge>;
  if (tier === "not_scorable") return <Badge title="No criterion had enough evidence">Not scorable</Badge>;
  return null;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, Tone]> = {
    awaiting_upload: ["Awaiting upload", "neutral"],
    queued: ["Queued", "neutral"],
    extracting: ["Extracting", "cyan"],
    extracted: ["Extracted", "cyan"],
    scoring: ["Scoring", "cyan"],
    scored: ["Scored", "ok"],
    needs_attention: ["Needs attention", "danger"],
    failed: ["Failed", "danger"],
    duplicate: ["Duplicate", "neutral"],
  };
  const [label, tone] = map[status] ?? [status, "neutral"];
  return <Badge tone={tone}>{["extracting", "scoring"].includes(status) && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot" />}{label}</Badge>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded border border-line-strong bg-surface-3 px-1 font-mono text-[10px] text-muted">{children}</span>;
}
