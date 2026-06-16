"use client";

import type { BandStatus } from "@/types";

// Four-state Must see / Maybe / Look into / Skip control (PRD §5.2). Tapping the
// active option again clears it (passes null). Laid out 2×2 so all four labels
// fit with 44px tap targets on a phone (a single row of four would wrap "Look
// into" on narrow screens). "Look into" is yellow with dark text — distinct from
// the sky-blue "Maybe" and high-contrast where white-on-yellow would not be.

const OPTIONS: { value: BandStatus; label: string; active: string }[] = [
  { value: "must", label: "Must see", active: "bg-rose-600 text-white ring-rose-600" },
  { value: "maybe", label: "Maybe", active: "bg-sky-600 text-white ring-sky-600" },
  { value: "look", label: "Look into", active: "bg-yellow-400 text-black ring-yellow-400" },
  { value: "skip", label: "Skip", active: "bg-zinc-600 text-white ring-zinc-600" },
];

export function StatusToggle({
  value,
  onChange,
}: {
  value: BandStatus | undefined;
  onChange: (status: BandStatus | null) => void;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-2"
      role="group"
      aria-label="My status for this band"
    >
      {OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(isActive ? null : opt.value)}
            className={`min-h-[44px] rounded-xl px-3 text-sm font-semibold ring-1 ring-inset transition-colors ${
              isActive
                ? opt.active
                : "bg-card text-foreground ring-border hover:bg-muted"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
