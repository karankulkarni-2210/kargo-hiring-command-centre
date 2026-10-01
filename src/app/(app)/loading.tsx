export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-7 w-64 rounded-md bg-surface-3 shimmer" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border border-line bg-surface shimmer" />
        ))}
      </div>
      <div className="h-80 rounded-xl border border-line bg-surface shimmer" />
    </div>
  );
}
