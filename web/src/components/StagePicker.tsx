import { ALL_STAGES, STAGE_LABELS, type Stage } from "../types";

// One- or two-click stage update. Selecting a value writes a NEW stage event
// (append), never overwriting history.
export function StagePicker({
  value,
  onChange,
  disabled,
}: {
  value: Stage;
  onChange: (stage: Stage) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      title="Record a stage transition — appends to the history, never overwrites"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = e.target.value as Stage;
        if (next !== value) onChange(next);
      }}
      className="input disabled:opacity-50"
    >
      {ALL_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
