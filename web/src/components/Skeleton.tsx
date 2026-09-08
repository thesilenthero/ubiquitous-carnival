// Loading placeholders. A shape that roughly matches what's coming reads as
// "nearly there" in a way the word "Loading…" never does.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** A stack of list rows, sized like the real thing. */
export function SkeletonRows({
  rows = 5,
  label = "Loading",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        // Trailing rows fade out, so the stack doesn't read as real content.
        <div key={i} style={{ opacity: 1 - i * (0.7 / rows) }}>
          <Skeleton className="h-14" />
        </div>
      ))}
    </div>
  );
}
