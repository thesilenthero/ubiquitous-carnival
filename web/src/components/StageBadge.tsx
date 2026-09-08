import { STAGE_COLORS, STAGE_LABELS, type Stage } from "../types";

export function StageBadge({ stage }: { stage: Stage }) {
  const color = STAGE_COLORS[stage];
  return (
    <span
      className="pill"
      style={{
        background: `color-mix(in srgb, ${color} 16%, var(--surface))`,
        color: `color-mix(in srgb, ${color} 65%, var(--text))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)`,
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
