import type { BandStatus } from "@/types";

// Compact marker shown on a list row when the band has a saved status.
// Hues are deliberately distinct from the green/amber/gray score chip:
// must = rose, maybe = sky, skip = zinc.
const MAP: Record<BandStatus, { label: string; cls: string }> = {
  must: { label: "★ Must", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
  maybe: { label: "Maybe", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  skip: { label: "Skip", cls: "bg-zinc-500/20 text-zinc-500 dark:text-zinc-400" },
};

export function StatusBadge({ status }: { status: BandStatus }) {
  const m = MAP[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
