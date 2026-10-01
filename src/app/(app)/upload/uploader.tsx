"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, buttonClass, cx, StatusBadge } from "@/components/ui";

type Item = {
  key: string;
  file: File;
  synthetic: boolean;
  phase: "ready" | "hashing" | "registering" | "uploading" | "processing" | "done" | "error" | "duplicate";
  progress: number;
  sha?: string;
  candidateId?: string;
  status?: string;
  error?: string;
  duplicateOf?: string;
};

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

const ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

async function sha256(file: File) {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function putWithProgress(url: string, file: File, apiKey: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", apiKey);
    xhr.setRequestHeader("authorization", `Bearer ${apiKey}`);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage upload failed (${xhr.status}) ${xhr.responseText.slice(0, 120)}`)));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const type = MIME[ext] ?? file.type;
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", new File([file], file.name, { type })); // explicit MIME: some OSes report "" for .docx
    xhr.send(fd);
  });
}

export function Uploader() {
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const add = (files: FileList | File[]) => {
    const next: Item[] = [];
    for (const f of Array.from(files)) {
      const ok = /\.(pdf|docx|txt)$/i.test(f.name);
      next.push({
        key: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        synthetic: /synthetic/i.test(f.name),
        phase: ok ? "ready" : "error",
        progress: 0,
        error: ok ? undefined : "Unsupported type — PDF, DOCX or TXT only",
      });
    }
    setItems((xs) => [...xs, ...next]);
  };

  const processOne = useCallback(async (it: Item) => {
    try {
      patch(it.key, { phase: "hashing", error: undefined, progress: 0 });
      const sha = it.sha ?? (await sha256(it.file));
      patch(it.key, { sha, phase: "registering" });
      const reg = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: [{ name: it.file.name, size: it.file.size, sha256: sha, synthetic: it.synthetic }] }),
      });
      const regBody = await reg.json();
      if (!reg.ok) throw new Error(regBody.error ?? "Registration failed");
      const r = regBody.files[0];
      if (!r.ok) {
        if (r.duplicate) return patch(it.key, { phase: "duplicate", duplicateOf: r.duplicateOf, error: r.error });
        throw new Error(r.error);
      }
      patch(it.key, { candidateId: r.candidateId, phase: "uploading" });
      await putWithProgress(r.signedUrl, it.file, regBody.apiKey, (p) => patch(it.key, { progress: p }));
      const done = await fetch(`/api/uploads/${r.candidateId}/complete`, { method: "POST" });
      const doneBody = await done.json();
      if (!done.ok) throw new Error(doneBody.error ?? "Could not queue processing");
      patch(it.key, { phase: "processing", status: "queued", progress: 100 });
      window.dispatchEvent(new Event("kargo:process"));
    } catch (e) {
      patch(it.key, { phase: "error", error: (e as Error).message });
    }
  }, []);

  const start = async () => {
    setRunning(true);
    const queue = items.filter((x) => x.phase === "ready");
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length) await processOne(queue.shift()!);
    });
    await Promise.all(workers);
    setRunning(false);
  };

  // Poll processing status for uploaded files.
  useEffect(() => {
    const ids = items.filter((x) => x.candidateId && x.phase === "processing").map((x) => x.candidateId!);
    if (!ids.length) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/candidates/status?ids=${ids.join(",")}`, { cache: "no-store" });
      if (!res.ok) return;
      const { candidates } = (await res.json()) as { candidates: { id: string; status: string; last_error: string | null; duplicate_of: string | null }[] };
      setItems((xs) =>
        xs.map((x) => {
          const c = candidates.find((k) => k.id === x.candidateId);
          if (!c || x.phase !== "processing") return x;
          if (c.status === "scored") return { ...x, status: c.status, phase: "done" };
          if (c.status === "duplicate") return { ...x, status: c.status, phase: "duplicate", duplicateOf: c.duplicate_of ?? undefined, error: c.last_error ?? "Duplicate" };
          if (c.status === "needs_attention" || c.status === "failed") return { ...x, status: c.status, phase: "error", error: c.last_error ?? "Processing failed" };
          return { ...x, status: c.status };
        }),
      );
    }, 4000);
    return () => clearInterval(t);
  }, [items]);

  const retry = async (it: Item) => {
    if (it.candidateId && (it.status === "needs_attention" || it.status === "failed")) {
      const r = await fetch(`/api/candidates/${it.candidateId}/retry`, { method: "POST" });
      if (r.ok) {
        patch(it.key, { phase: "processing", status: "queued", error: undefined });
        window.dispatchEvent(new Event("kargo:process"));
      } else patch(it.key, { error: (await r.json()).error });
      return;
    }
    await processOne({ ...it, phase: "ready" });
  };

  const readyCount = items.filter((x) => x.phase === "ready").length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface/80 p-4 text-xs leading-relaxed text-muted">
        <span className="font-medium text-text">No role to choose.</span> Every CV is scored against both the PM and SPM rubrics, then placed in the role it fits better: by score when coverage is comparable, otherwise by which role the CV has more evidence for. You can move anyone from their candidate page.
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cx(
          "grid-texture cursor-pointer rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
          drag ? "border-accent bg-accent/5" : "border-line-strong hover:border-accent/60",
        )}
      >
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && add(e.target.files)} />
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg border border-line-strong bg-surface-2 text-accent-strong">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg>
        </div>
        <div className="text-sm font-medium">Drop CVs here or click to choose</div>
        <div className="mt-1 text-xs text-muted">Multiple files · PDF / DOCX / TXT · duplicates are detected by file fingerprint</div>
      </div>

      {items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface/80">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm text-muted">
              {items.length} file{items.length === 1 ? "" : "s"} · {readyCount} ready
            </div>
            <div className="flex items-center gap-2">
              <button className={buttonClass("ghost")} onClick={() => setItems((xs) => xs.filter((x) => !["done", "duplicate"].includes(x.phase)))}>Clear finished</button>
              <button className={buttonClass("primary")} disabled={running || readyCount === 0} onClick={start}>
                {running ? "Uploading…" : `Upload ${readyCount || ""}`}
              </button>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {items.map((it) => (
              <li key={it.key} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm">{it.file.name}</span>
                      <span className="font-mono text-[11px] text-faint">{(it.file.size / 1024).toFixed(0)} KB</span>
                      {it.synthetic && <Badge tone="cyan">Synthetic</Badge>}
                    </div>
                    {it.error && <div className="mt-1 text-xs text-danger">{it.error}</div>}
                  </div>
                  {it.phase === "ready" ? (
                    <>
                      <label className="flex items-center gap-1.5 text-xs text-muted">
                        <input type="checkbox" checked={it.synthetic} onChange={(e) => patch(it.key, { synthetic: e.target.checked })} /> synthetic
                      </label>
                      <button className="text-xs text-faint hover:text-danger" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>Remove</button>
                    </>
                  ) : null}
                  <PhaseView it={it} onRetry={() => retry(it)} />
                </div>
                {(it.phase === "uploading" || it.phase === "hashing" || it.phase === "registering") && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${it.phase === "uploading" ? it.progress : 8}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PhaseView({ it, onRetry }: { it: Item; onRetry: () => void }) {
  if (it.phase === "processing") return <StatusBadge status={it.status ?? "queued"} />;
  if (it.phase === "done")
    return (
      <span className="flex items-center gap-2">
        <StatusBadge status="scored" />
        <Link href={`/candidates/${it.candidateId}`} className="text-xs text-accent-strong hover:underline">Open →</Link>
      </span>
    );
  if (it.phase === "duplicate")
    return (
      <span className="flex items-center gap-2">
        <Badge>Duplicate</Badge>
        {it.duplicateOf && <Link href={`/candidates/${it.duplicateOf}`} className="text-xs text-accent-strong hover:underline">Existing →</Link>}
      </span>
    );
  if (it.phase === "error")
    return (
      <button onClick={onRetry} className="rounded-md border border-danger/50 px-2 py-1 text-xs text-danger hover:bg-danger/10">
        Retry
      </button>
    );
  if (it.phase === "ready") return null;
  return <span className="font-mono text-xs text-muted">{it.phase === "uploading" ? `${it.progress}%` : `${it.phase}…`}</span>;
}
