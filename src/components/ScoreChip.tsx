// Colored score chip (PRD §5.1). Color tracks the bucket, not arbitrary
// cutoffs: In your rotation / Must see = green, High match = amber, rest = gray.

function chipClasses(bucket: string): string {
  switch (bucket) {
    case "In your rotation":
    case "Must see":
      return "bg-green-500/15 text-green-700 ring-green-600/30 dark:text-green-300";
    case "High match":
      return "bg-amber-500/15 text-amber-700 ring-amber-600/30 dark:text-amber-300";
    default:
      return "bg-zinc-500/15 text-zinc-600 ring-zinc-500/25 dark:text-zinc-400";
  }
}

export function ScoreChip({ score, bucket }: { score: number; bucket: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${chipClasses(
        bucket,
      )}`}
    >
      {score.toFixed(1)}
    </span>
  );
}
