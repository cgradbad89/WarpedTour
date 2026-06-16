// Star rendering of a 1.0–5.0 score with half-star precision (PRD §5.1).
// Two stacked rows of five stars: a muted outline row sets the width, a gold
// fill row is absolutely positioned over it and clipped to (score / 5).

export function Stars({ score, size = 14 }: { score: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));
  return (
    <span
      className="relative inline-block whitespace-nowrap align-middle leading-none select-none"
      style={{ fontSize: size }}
      role="img"
      aria-label={`${score.toFixed(1)} out of 5`}
      title={`${score.toFixed(1)} / 5`}
    >
      <span className="text-zinc-300 dark:text-zinc-600">★★★★★</span>
      <span
        className="absolute inset-0 overflow-hidden whitespace-nowrap text-amber-400"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      >
        ★★★★★
      </span>
    </span>
  );
}
