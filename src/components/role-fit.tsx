"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RoleFitStored } from "@/lib/data";
import { Badge, buttonClass } from "./ui";

type Role = "PM" | "SPM";

const BASIS: Record<RoleFitStored["basis"], string> = {
  score: "Higher score",
  coverage: "More evidence",
  only_scorable: "Only scorable role",
  none: "No scorable evidence",
};

export function RoleFitPanel({
  candidateId,
  role,
  source,
  fit,
  locked,
}: {
  candidateId: string;
  role: Role | null;
  source: "auto" | "founder";
  fit: RoleFitStored | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = async (target: Role | "auto") => {
    setBusy(target);
    setErr(null);
    const r = await fetch(`/api/candidates/${candidateId}/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: target }),
    });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "Could not change role");
    else window.dispatchEvent(new Event("kargo:process"));
    setBusy(null);
    router.refresh();
  };

  const differs = source === "founder" && fit?.role && fit.role !== role;

  return (
    <div className="rounded-xl border border-line bg-surface/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Role fit</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {role ? <span className="text-lg font-semibold">Ranked in {role}</span> : <span className="text-lg font-semibold text-warn">No role assigned yet</span>}
            {source === "founder" ? <Badge tone="accent">Set by you</Badge> : role ? <Badge>Automatic</Badge> : null}
            {fit && fit.basis !== "none" && <Badge tone={fit.confidence === "comparable" ? "ok" : "warn"}>{BASIS[fit.basis]}{fit.confidence === "low" ? " · low confidence" : ""}</Badge>}
            {fit?.closeCall && <Badge tone="warn">Close call</Badge>}
            {locked && <Badge>Locked: decision recorded</Badge>}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{fit ? fit.reason : "Role is assigned once the CV has been scored against both rubrics."}</p>
          {differs && <p className="mt-1 text-xs text-warn">The automatic fit would be {fit!.role}; your choice is kept.</p>}
        </div>
        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            {(["PM", "SPM"] as Role[]).map((r) => (
              <button key={r} className={buttonClass(role === r && source === "founder" ? "primary" : "outline")} disabled={busy !== null || (role === r && source === "founder")} onClick={() => set(r)}>
                {busy === r ? "Moving…" : role === r ? `Keep in ${r}` : `Move to ${r}`}
              </button>
            ))}
            {source === "founder" && (
              <button className={buttonClass("ghost")} disabled={busy !== null} onClick={() => set("auto")}>
                {busy === "auto" ? "Resetting…" : "Back to automatic"}
              </button>
            )}
          </div>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      <p className="mt-3 text-[11px] text-faint">
        Scores are compared only when both roles have ≥70% coverage and are within 15 pp (rubric §6.3); otherwise the role with more evidence is used. Years of experience are never used. Changing role never contacts anyone.
      </p>
    </div>
  );
}
