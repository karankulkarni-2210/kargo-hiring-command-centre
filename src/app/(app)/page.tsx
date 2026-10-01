import Link from "next/link";
import { requireFounderPage } from "@/lib/auth";
import { dashboardData } from "@/lib/data";
import { ROLE_TITLES, type Role } from "@/lib/rubric/types";
import type { RubricValidation } from "@/lib/rubric/types";
import { ReassignRolesButton } from "@/components/reassign-roles-button";
import { Badge, ButtonLink, Card, DECISION_LABEL, DECISION_TONE, EmptyState, Notice, ScoreCoverage, Stat, StatusBadge, TierBadge, recTone } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { supabase } = await requireFounderPage();
  const d = await dashboardData(supabase);
  const v = d.activeRubric?.validation as RubricValidation | undefined;
  const attention = d.rows.filter((r) => ["needs_attention", "failed"].includes(r.status));
  const unranked = d.rows.filter((r) => r.applied_rank === null && !["needs_attention", "failed"].includes(r.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shortlist command</h1>
          <p className="mt-1 text-sm text-muted">Each CV is scored for both roles and ranked in the one it fits better. Review the top five, glance below the line once, then decide.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReassignRolesButton />
          <ButtonLink href="/upload" variant="primary">Upload CVs</ButtonLink>
          <ButtonLink href="/rubric" variant="outline">Rubric</ButtonLink>
        </div>
      </div>

      {!d.activeRubric && <Notice tone="danger" title="No active rubric">Import and activate a rubric before uploading CVs.</Notice>}
      {d.activeRubric && /PROVISIONAL/i.test(d.activeRubric.declared_status) && (
        <Notice title={`Rubric v${d.activeRubric.version_label} is PROVISIONAL — scores are JD-derived, not calibrated against past hires`}>
          No criterion has historical hire support
          {v && !v.assignmentFit.perRole.SPM.withinRange && <> · SPM has {v.assignmentFit.perRole.SPM.criteriaCount} criteria (assignment asks for 4–6)</>}. Treat rankings as a reading aid, not a prediction.{" "}
          <Link className="text-accent-strong hover:underline" href="/rubric">Details →</Link>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Applications" value={d.counts.total} hint={<>PM {d.counts.byRole.PM} · SPM {d.counts.byRole.SPM}</>} />
        <Stat label="Scored (both roles)" value={d.counts.scored} hint={`of ${d.counts.total}`} tone="accent" />
        <Stat label="In pipeline" value={d.counts.processing + d.counts.awaitingUpload} hint={d.counts.awaitingUpload ? `${d.counts.awaitingUpload} awaiting upload` : "extract → score → rank"} />
        <Stat label="Needs attention" value={d.counts.attention} tone={d.counts.attention ? "danger" : undefined} hint={d.counts.duplicates ? `${d.counts.duplicates} duplicate upload(s) skipped` : "unreadable / failed"} />
        <Stat label="Pending decisions" value={d.counts.pendingDecisions} tone={d.counts.pendingDecisions ? "warn" : undefined} hint={`${d.counts.decided} decided`} />
        <Stat label="Emails sent" value={d.counts.emailsSent} hint="only after your confirmation" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {(["PM", "SPM"] as Role[]).map((role) => (
          <RankedList key={role} role={role} rows={d.ranked[role]} />
        ))}
      </div>

      {(attention.length > 0 || unranked.length > 0) && (
        <Card title="Not yet ranked" subtitle="Processing, failed or unreadable CVs, and CVs with no scorable evidence for either role (choose a role on their page). Missing evidence is never turned into a low score.">
          <ul className="divide-y divide-line">
            {[...attention, ...unranked].map((r) => (
              <li key={r.id} className="relative flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm hover:bg-surface-2/50">
                <div className="flex min-w-0 items-center gap-2">
                  {r.applied_role ? <Badge>{r.applied_role}</Badge> : r.status === "scored" ? <Badge tone="warn">Needs a role</Badge> : <Badge>Role after scoring</Badge>}
                  <Link href={`/candidates/${r.id}`} className="truncate after:absolute after:inset-0 after:content-[''] hover:text-accent-strong">{r.name ?? r.original_filename}</Link>
                  {r.is_synthetic && <Badge tone="cyan">Synthetic</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  {r.last_error && <span className="max-w-md truncate text-xs text-danger" title={r.last_error}>{r.last_error}</span>}
                  <StatusBadge status={r.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Row = Awaited<ReturnType<typeof dashboardData>>["ranked"]["PM"][number];

function RankedList({ role, rows }: { role: Role; rows: Row[] }) {
  const top = rows.filter((r) => r.in_top5);
  const rest = rows.filter((r) => !r.in_top5);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono text-accent-strong">{role}</span> {ROLE_TITLES[role]}
        </span>
      }
      subtitle={`${rows.length} ranked · ordered by score only among comparable coverage (≥70%); below that, by evidence coverage`}
      action={<Badge tone="accent">Top 5 → brief + invite draft</Badge>}
      className="overflow-hidden"
    >
      {rows.length === 0 ? (
        <EmptyState title="No ranked candidates yet">Upload CVs for this role. Each is scored against both rubrics and ranked here within its applied role.</EmptyState>
      ) : (
        <div className="-mx-5 -my-5">
          <ol>
            {top.map((r) => (
              <RankRow key={r.id} r={r} role={role} />
            ))}
          </ol>
          {rest.length > 0 && (
            <>
              <div className="flex items-center gap-3 border-y border-line bg-surface-2/60 px-5 py-2 text-[11px] uppercase tracking-[0.14em] text-faint">
                <span className="h-px flex-1 bg-line-strong" />
                Below the line · rejection draft suggested — nothing is sent
                <span className="h-px flex-1 bg-line-strong" />
              </div>
              <ol>
                {rest.map((r) => (
                  <RankRow key={r.id} r={r} role={role} />
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function RankRow({ r, role }: { r: Row; role: Role }) {
  const ev = r.evals[role];
  const other: Role = role === "PM" ? "SPM" : "PM";
  const oev = r.evals[other];
  const sent = r.sends.some((s) => s.status === "sent");
  return (
    <li className="group relative cursor-pointer border-b border-line/70 px-5 py-3 transition-colors last:border-b-0 hover:bg-surface-2/70">
      <div className="flex items-center gap-4">
        <div className={`w-7 text-center font-mono text-sm tabular-nums ${r.in_top5 ? "text-accent-strong" : "text-faint"}`}>{r.applied_rank}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Stretched link: the whole row opens the candidate. */}
            <Link href={`/candidates/${r.id}`} className="truncate text-sm font-medium after:absolute after:inset-0 after:content-[''] group-hover:text-accent-strong">
              {r.name ?? r.original_filename}
            </Link>
            {r.is_synthetic && <Badge tone="cyan">Synthetic</Badge>}
            {r.possible_duplicate_of && <Badge tone="warn" title="Same email as another application">Possible duplicate</Badge>}
            {r.role_source === "founder" ? (
              <Badge tone="accent" title="You placed this candidate in this role">Role set by you</Badge>
            ) : r.role_fit?.confidence === "low" || r.role_fit?.closeCall ? (
              <Badge tone="warn" title={r.role_fit.reason}>Fit: low confidence</Badge>
            ) : null}
            <TierBadge tier={r.rank_tier} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {ev && <Badge tone={recTone(ev.recommendation)}>{ev.recommendation}</Badge>}
            {r.decision ? <Badge tone={DECISION_TONE[r.decision.decision]}>Decision: {DECISION_LABEL[r.decision.decision]}</Badge> : <Badge>Decision pending</Badge>}
            {sent && <Badge tone="ok">Email sent</Badge>}
            {oev && oev.score !== null && (
              <span className="text-[11px] text-faint">
                {other}: <span className="font-mono">{Number(oev.score).toFixed(1)}</span> @ {Number(oev.coverage_pct)}%
              </span>
            )}
          </div>
          {r.in_top5 && r.brief && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{r.brief[0]}</p>}
        </div>
        {ev && <ScoreCoverage compact score={ev.score === null ? null : Number(ev.score)} coverage={Number(ev.coverage_pct)} interpretable={Boolean(ev.recommendation_reasons?.interpretable)} />}
        <Link href={`/candidates/${r.id}/decision`} className="relative z-10 shrink-0 rounded-md border border-line-strong px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-text">
          Decide
        </Link>
      </div>
    </li>
  );
}
