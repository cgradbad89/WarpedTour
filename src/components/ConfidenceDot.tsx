import type { PredConfidence } from "@/types";

// Small colored dot for a band's PREDICTED schedule confidence (PRD §11).
// high = success (green), medium = warning (amber), low = muted (zinc).
// Returns null for a missing/unknown value so callers can render it
// unconditionally without guarding (graceful when pred fields are absent).

const MAP: Record<PredConfidence, { cls: string; label: string }> = {
  high: { cls: "bg-emerald-500", label: "High confidence — named headliner" },
  medium: { cls: "bg-amber-500", label: "Medium confidence — main-stage / high-draw" },
  low: { cls: "bg-zinc-400 dark:bg-zinc-500", label: "Low confidence — inferred" },
};

export function ConfidenceDot({ confidence }: { confidence?: PredConfidence }) {
  const m = confidence ? MAP[confidence] : undefined;
  if (!m) return null;
  return (
    <span
      role="img"
      aria-label={m.label}
      title={m.label}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${m.cls}`}
    />
  );
}
