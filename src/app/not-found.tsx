import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <div className="font-mono text-sm text-accent-strong">404</div>
        <h1 className="mt-2 text-xl font-semibold">Not found</h1>
        <Link href="/" className="mt-4 inline-block text-sm text-muted hover:text-text">← Back to dashboard</Link>
      </div>
    </main>
  );
}
