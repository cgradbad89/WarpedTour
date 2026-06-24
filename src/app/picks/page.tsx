"use client";

import { useMemo, useState } from "react";
import { useExplorerData } from "@/lib/profile";
import { usePersonalState } from "@/lib/personal";
import type { Band, BandStatus } from "@/types";
import { Nav } from "@/components/Nav";
import { PicksSection } from "@/components/PicksSection";
import { BandDetail } from "@/components/BandDetail";
import { DayFilter, shortDayLabel } from "@/components/DayFilter";

const SECTIONS: { status: BandStatus; label: string; activeChip: string }[] = [
  { status: "must", label: "Must see", activeChip: "bg-rose-600 text-white ring-rose-600" },
  { status: "maybe", label: "Maybe", activeChip: "bg-sky-600 text-white ring-sky-600" },
  { status: "look", label: "Look into", activeChip: "bg-yellow-400 text-black ring-yellow-400" },
  { status: "skip", label: "Skip", activeChip: "bg-zinc-600 text-white ring-zinc-600" },
];

export default function PicksPage() {
  const { data, loading, error, profile } = useExplorerData();
  const { status, order, changeStatus, setSectionOrder, resetSectionOrder, clearAll, pickCount } =
    usePersonalState();

  const clearPicks = () => {
    if (pickCount === 0) return;
    if (!window.confirm("Clear all your picks? This can't be undone.")) return;
    clearAll();
  };

  // Which sections are visible — a pure view filter, doesn't change stored status.
  const [shown, setShown] = useState<Record<BandStatus, boolean>>({
    must: true,
    maybe: true,
    look: true,
    skip: true,
  });
  // Sat/Sun day filter — null = all days (default). Schedule data, taste-
  // independent (PRD §11.4); reads each band's pred_day, never writes.
  const [day, setDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<Band | null>(null);

  const days = data?.schedule?.days ?? [];
  const matchesDay = (b: Band) => day === null || b.pred_day === day;

  const byName = useMemo(() => {
    const m = new Map<string, Band>();
    data?.bands.forEach((b) => m.set(b.name, b));
    return m;
  }, [data]);

  // Per-section ordered band list: saved order first (pruned to current picks),
  // then any remaining picks by score desc (ties by fans desc). Names missing
  // from bands.json are skipped (a refresh can't orphan the UI).
  const sectionBands = useMemo(() => {
    const out: Record<BandStatus, Band[]> = { must: [], maybe: [], look: [], skip: [] };
    if (!data) return out;
    for (const { status: s } of SECTIONS) {
      const picked = Object.keys(status).filter((n) => status[n] === s);
      const pickedSet = new Set(picked);
      const saved = (order[s] ?? []).filter((n) => pickedSet.has(n));
      const savedSet = new Set(saved);
      const remaining = picked
        .filter((n) => !savedSet.has(n))
        .map((n) => byName.get(n))
        .filter((b): b is Band => Boolean(b))
        .sort((a, b) => b.score - a.score || b.fans - a.fans)
        .map((b) => b.name);
      out[s] = [...saved, ...remaining]
        .map((n) => byName.get(n))
        .filter((b): b is Band => Boolean(b));
    }
    return out;
  }, [data, status, order, byName]);

  // Persist a reorder. With no day filter the section's full order is what the
  // user reordered. Under a day filter the section only renders one day's picks,
  // so we re-weave the new visible order back into the full order — the hidden
  // day's picks keep their saved positions (a day filter must never drop or
  // scramble the other day).
  const persistReorder = (s: BandStatus, visibleOrder: string[]) => {
    if (day === null) {
      setSectionOrder(s, visibleOrder);
      return;
    }
    const full = sectionBands[s].map((b) => b.name);
    const matchSet = new Set(
      sectionBands[s].filter(matchesDay).map((b) => b.name),
    );
    const q = [...visibleOrder];
    const merged = full.map((n) => (matchSet.has(n) ? (q.shift() as string) : n));
    setSectionOrder(s, merged);
  };

  const totalPicks = Object.keys(status).length;

  // Per-status counts for the visibility chips (display only — derived from the
  // stored status map, so they're correct before bands.json finishes loading).
  const counts = useMemo(() => {
    const c: Record<BandStatus, number> = { must: 0, maybe: 0, look: 0, skip: 0 };
    for (const s of Object.values(status)) c[s] += 1;
    return c;
  }, [status]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        {/* Shared nav strip: tabs left, account right, one pinned row. */}
        <div className="px-4 pt-3 pb-2">
          <Nav />
        </div>
        {/* Title + Clear — Clear lives on this page, next to the picks it clears. */}
        <div className="flex items-center justify-between gap-2 px-4 pb-2">
          <h1 className="text-base font-extrabold leading-tight">My picks</h1>
          {pickCount > 0 && (
            <button
              type="button"
              onClick={clearPicks}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border transition-colors hover:bg-muted"
            >
              Clear ({pickCount})
            </button>
          )}
        </div>
        {/* Status-visibility chips — the primary control row. Count stacked under
            each label so chips stay narrow enough to keep all four on one row at
            375px (the grid wraps gracefully on anything narrower). */}
        <div className="grid grid-cols-4 gap-1.5 px-4 pb-2">
          {SECTIONS.map(({ status: s, label, activeChip }) => (
            <button
              key={s}
              type="button"
              role="switch"
              aria-checked={shown[s]}
              onClick={() => setShown((v) => ({ ...v, [s]: !v[s] }))}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-xs font-semibold leading-tight ring-1 ring-inset transition-colors ${
                shown[s] ? activeChip : "bg-card text-muted-foreground ring-border hover:bg-muted"
              }`}
            >
              <span>{label}</span>
              <span className="text-[11px] font-bold tabular-nums opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>
        {/* Sat/Sun day filter — schedule data, filters each status section by
            pred_day. Composes with the status-visibility chips above. */}
        {days.length > 0 && (
          <div className="px-4 pb-3">
            <DayFilter days={days} value={day} onChange={setDay} />
          </div>
        )}
      </header>

      <main className="flex-1">
        {loading && (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Loading bands…
          </p>
        )}
        {error && (
          <p className="px-4 py-12 text-center text-sm text-red-600 dark:text-red-400">
            {error} Try refreshing the page.
          </p>
        )}
        {data && totalPicks === 0 && (
          <div className="px-4 py-16 text-center">
            <p className="text-sm font-medium">You haven&apos;t marked any bands yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a band on the Lineup and pick Must see / Maybe / Skip.
            </p>
          </div>
        )}
        {data &&
          totalPicks > 0 &&
          SECTIONS.map(({ status: s, label }) => {
            if (!shown[s]) return null;
            const visibleBands = sectionBands[s].filter(matchesDay);
            return (
              <PicksSection
                key={s}
                label={label}
                status={s}
                bands={visibleBands}
                hasManualOrder={(order[s]?.length ?? 0) > 0}
                emptyDayLabel={day === null ? null : shortDayLabel(day)}
                onReorder={(names) => persistReorder(s, names)}
                onReset={() => resetSectionOrder(s)}
                onOpen={setSelected}
              />
            );
          })}
      </main>

      {selected && (
        <BandDetail
          band={selected}
          status={status[selected.name]}
          rescored={Boolean(profile)}
          onStatusChange={(next) => changeStatus(selected.name, next)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
