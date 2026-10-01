"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui";

export function RubricActions({ activeId, activateId, staleEvals }: { activeId?: string; activateId?: string; staleEvals?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (activateId)
    return (
      <button
        className={buttonClass("outline") + " px-2.5 py-1 text-xs"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch(`/api/rubric/${activateId}/activate`, { method: "POST" });
          setBusy(false);
          if (!r.ok) setMsg((await r.json()).error);
          router.refresh();
        }}
      >
        {busy ? "Activating…" : "Activate"}
        {msg && <span className="text-danger"> {msg}</span>}
      </button>
    );
  return (
    <div className="flex items-center gap-2">
      <a href={`/api/rubric/${activeId}/export`} className={buttonClass("ghost")}>Export JSON</a>
      <button
        className={buttonClass("outline")}
        disabled={busy}
        title="Queue scoring for candidates not yet evaluated with the active rubric"
        onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/rubric/rescore", { method: "POST" });
          const b = await r.json();
          setBusy(false);
          setMsg(r.ok ? `${b.queued} scoring job(s) queued` : b.error);
          window.dispatchEvent(new Event("kargo:process"));
        }}
      >
        Re-score with active rubric{staleEvals ? ` (${staleEvals})` : ""}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}

type Issue = { level: string; message: string; role?: string };

export function RubricImport() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"auto" | "ai">("auto");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; issues?: Issue[]; details?: string[] } | null>(null);
  return (
    <div className="space-y-3">
      <input type="file" accept=".txt,.json,text/plain,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-text" />
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "auto"} onChange={() => setMode("auto")} /> Deterministic (Rubix text layout or JSON)</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "ai"} onChange={() => setMode("ai")} /> AI-assisted transcription (verbatim-checked)</label>
      </div>
      <button
        className={buttonClass("primary")}
        disabled={!file || busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          const fd = new FormData();
          fd.append("file", file!);
          fd.append("mode", mode);
          const r = await fetch("/api/rubric/import", { method: "POST", body: fd });
          const b = await r.json();
          setBusy(false);
          if (!r.ok) setResult({ ok: false, text: b.error, details: b.details });
          else setResult({ ok: b.validation.ok, text: b.validation.ok ? "Imported as an inactive version. Review it, then Activate." : "Imported, but validation failed — it cannot be activated.", issues: b.validation.issues });
          router.refresh();
        }}
      >
        {busy ? "Importing…" : "Import & validate"}
      </button>
      {result && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${result.ok ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>
          <div>{result.text}</div>
          <ul className="mt-1 space-y-0.5 text-muted">
            {(result.details ?? []).map((d, i) => (
              <li key={i}>· {d}</li>
            ))}
            {(result.issues ?? []).filter((i) => i.level !== "info").map((i, k) => (
              <li key={k}>· [{i.level}] {i.role ? `${i.role}: ` : ""}{i.message}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-faint">Weights must total exactly 100% per role and every criterion needs anchors 1–5, or activation is blocked. Each evaluation records the rubric version that produced it.</p>
    </div>
  );
}
