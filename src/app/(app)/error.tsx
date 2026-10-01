"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-danger/40 bg-surface p-6">
      <div className="text-sm font-semibold text-danger">Something went wrong loading this page</div>
      <p className="mt-2 text-sm text-muted">{error.message}</p>
      <button onClick={reset} className="mt-4 rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:border-accent">Try again</button>
    </div>
  );
}
