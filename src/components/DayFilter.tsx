"use client";

// A compact 3-way day filter (All / Sat / Sun) shared by the Lineup ("/") and My
// Picks ("/picks") pages. It reads the day labels from `schedule.days` — this is
// TASTE-INDEPENDENT schedule data, so the control behaves identically logged in
// or out and with or without an uploaded profile (PRD §11.4). `value === null`
// means "All days" (the default — no filtering). Filtering keys off each band's
// `pred_day`; a band with no `pred_day` simply never matches a specific-day
// filter (the callers guard for that), so a missing field can't crash anything.
//
// Day labels are shortened to fit a phone header cleanly: "Sat Jul 25" → "Sat 25"
// (PRD §3.2 day strings). Buttons are equal-width and ≥44px tall.

/** "Sat Jul 25" → "Sat 25" (compact, unambiguous); falls back to the raw label. */
export function shortDayLabel(day: string): string {
  const parts = day.split(" ");
  if (parts.length >= 3) return `${parts[0]} ${parts[2]}`;
  return parts[0] ?? day;
}

export function DayFilter({
  days,
  value,
  onChange,
}: {
  /** Full day strings from `schedule.days`, e.g. ["Sat Jul 25", "Sun Jul 26"]. */
  days: string[];
  /** Selected full day string, or null for "All days". */
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (days.length === 0) return null;
  const options: { label: string; val: string | null }[] = [
    { label: "All", val: null },
    ...days.map((d) => ({ label: shortDayLabel(d), val: d })),
  ];
  return (
    <div className="flex gap-1.5" role="group" aria-label="Filter by day">
      {options.map((o) => {
        const active = value === o.val;
        return (
          <button
            key={o.val ?? "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.val)}
            className={`min-h-[44px] flex-1 rounded-xl px-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
              active
                ? "bg-accent text-accent-foreground ring-accent"
                : "bg-card text-muted-foreground ring-border hover:bg-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
