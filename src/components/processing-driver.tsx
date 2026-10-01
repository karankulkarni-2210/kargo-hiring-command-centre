"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "./ui";

type Queue = { ready: number; waiting: number; running: number; failed: number; nextRunInSec: number | null; byKind: Record<string, number> };

/**
 * Drives the resumable job queue from the founder's browser: while work is queued it calls
 * /api/process/tick (one short, bounded request at a time). Closing the tab just pauses
 * processing; it resumes from the database queue next time any page is open.
 */
export function ProcessingDriver() {
  const router = useRouter();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [state, setState] = useState<"idle" | "working" | "waiting" | "blocked" | "error">("idle");
  const [msg, setMsg] = useState<string>("");
  const busy = useRef(false);
  const lastRefresh = useRef(0);

  const refresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefresh.current > 6000) {
      lastRefresh.current = now;
      router.refresh();
    }
  }, [router]);

  const loop = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (let i = 0; i < 400; i++) {
        const s = await fetch("/api/process/status", { cache: "no-store" });
        if (!s.ok) throw new Error((await s.json().catch(() => ({}))).error ?? s.statusText);
        const { queue: q, geminiConfigured } = (await s.json()) as { queue: Queue; geminiConfigured: boolean };
        setQueue(q);
        if (!geminiConfigured && q.ready + q.waiting > 0) {
          setState("blocked");
          setMsg("Gemini not configured");
          break;
        }
        if (q.ready === 0) {
          if (q.waiting > 0) {
            setState("waiting");
            setMsg(q.nextRunInSec ? `Resuming in ${q.nextRunInSec}s` : "Waiting");
            await new Promise((r) => setTimeout(r, Math.min(30, q.nextRunInSec ?? 10) * 1000));
            continue;
          }
          setState("idle");
          setMsg("");
          break;
        }
        setState("working");
        setMsg("");
        const t = await fetch("/api/process/tick", { method: "POST" });
        const body = await t.json().catch(() => ({}));
        if (!t.ok) throw new Error(body.error ?? t.statusText);
        if (body.queue) setQueue(body.queue);
        refresh();
        if (body.blocked) {
          setState("blocked");
          setMsg(body.blocked);
          break;
        }
        if (body.retryAfterSec) {
          setState("waiting");
          setMsg(`Rate limited — resuming in ${body.retryAfterSec}s`);
          await new Promise((r) => setTimeout(r, Math.min(90, body.retryAfterSec) * 1000));
        }
      }
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
    } finally {
      busy.current = false;
      lastRefresh.current = 0;
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    const first = setTimeout(loop, 0);
    const id = setInterval(loop, 15000);
    const kick = () => loop();
    window.addEventListener("kargo:process", kick);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("kargo:process", kick);
    };
  }, [loop]);

  const pending = queue ? queue.ready + queue.waiting + queue.running : 0;
  return (
    <div className="flex items-center gap-2 text-xs" aria-live="polite">
      <span
        className={cx(
          "h-2 w-2 rounded-full",
          state === "working" ? "bg-cyan animate-pulse-dot" : state === "waiting" ? "bg-warn animate-pulse-dot" : state === "blocked" || state === "error" ? "bg-danger" : "bg-ok",
        )}
      />
      <span className="text-muted">
        {state === "working" && <>Processing · <span className="font-mono text-text">{pending}</span> job{pending === 1 ? "" : "s"} queued</>}
        {state === "waiting" && <>{msg} · <span className="font-mono text-text">{pending}</span> queued</>}
        {state === "blocked" && <span className="text-danger">Paused: {msg}</span>}
        {state === "error" && <span className="text-danger" title={msg}>Processing error — retrying</span>}
        {state === "idle" && <>Pipeline idle{queue?.failed ? <> · <span className="text-danger">{queue.failed} failed</span></> : null}</>}
      </span>
    </div>
  );
}
