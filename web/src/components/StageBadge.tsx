import { STAGE_COLORS, STAGE_LABELS, type Stage } from "../types";

export function StageBadge({ stage }: { stage: Stage }) {
  const color = STAGE_COLORS[stage];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        background: `color-mix(in srgb, ${color} 20%, var(--surface))`,
        color: `color-mix(in srgb, ${color} 70%, var(--text))`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      {STAGE_LABELS[stage]}
    </span>
  );
}
