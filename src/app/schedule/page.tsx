"use client";

import { useMemo, useState } from "react";
import { useExplorerData } from "@/lib/profile";
import { usePersonalState } from "@/lib/personal";
import type { Band, StatusMap } from "@/types";
import { Nav } from "@/components/Nav";
import { BandDetail } from "@/components/BandDetail";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfidenceDot } from "@/components/ConfidenceDot";

// Predicted schedule — a day-by-day, stage-by-stage grid (PRD §11). The pred_*
// fields and the top-level `schedule` block are TASTE-INDEPENDENT: they read
// straight from bands.json and survive an uploaded-profile re-score unchanged
// (rescoreDataset spreads them through), so this view is identical for the owner
// and any friend. Tapping a row opens the shared BandDetail modal.

// A band is placeable on the grid only if it carries the fields we need; anything
// lacking them is silently omitted rather than crashing the page.
function hasPred(b: Band): boolean {
  return (
    typeof b.pred_day === "string" &&
    typeof b.pred_stage === "string" &&
    typeof b.pred_time_min === "number"
  );
}

// Must-see picks on `day` whose [start, start+len) intervals overlap. Returns the
// set of band names caught in any clash — you can't be two places at once.
function mustConflictNames(bands: Band[], day: string, status: StatusMap): Set<string> {
  const must = bands.filter(
    (b) => hasPred(b) && b.pred_day === day && status[b.name] === "must",
  );
  const out = new Set<string>();
  for (let i = 0; i < must.length; i++) {
    for (let j = i + 1; j < must.length; j++) {
      const a = must[i];
      const b = must[j];
      const aStart = a.pred_time_min as number;
      const bStart = b.pred_time_min as number;
      const aEnd = aStart + (a.pred_setlen_min ?? 0);
      const bEnd = bStart + (b.pred_setlen_min ?? 0);
      if (aStart < bEnd && bStart < aEnd) {
        out.add(a.name);
        out.add(b.name);
      }
    }
  }
  return out;
}

export default function SchedulePage() {
  const { data, loading, error, profile } = useExplorerData();
  const { status, changeStatus } = usePersonalState();

  const [day, setDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<Band | null>(null);

  const schedule = data?.schedule;
  const days = schedule?.days ?? [];
  const stages = schedule?.stages ?? [];
  const activeDay = day ?? days[0] ?? null;

  // Stage groups for the active day, each sorted by predicted start time.
  const stageGroups = useMemo(() => {
    if (!data || !activeDay) return [];
    const dayBands = data.bands.filter((b) => hasPred(b) && b.pred_day === activeDay);
    return stages
      .map((stage) => ({
        stage,
        acts: dayBands
          .filter((b) => b.pred_stage === stage)
          .sort(
            (a, b) =>
              (a.pred_time_min as number) - (b.pred_time_min as number) ||
              a.name.localeCompare(b.name),
          ),
      }))
      .filter((g) => g.acts.length > 0);
  }, [data, activeDay, stages]);

  const conflicts = useMemo(
    () =>
      data && activeDay
        ? mustConflictNames(data.bands, activeDay, status)
        : new Set<string>(),
    [data, activeDay, status],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <h1 className="text-base font-extrabold leading-tight">Schedule</h1>
          <Nav />
        </div>
        {days.length > 0 && (
          <div className="flex gap-1.5 px-4 pb-3" role="tablist" aria-label="Day">
            {days.map((d) => {
              const active = d === activeDay;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setDay(d)}
                  className={`min-h-[40px] flex-1 rounded-xl px-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                    active
                      ? "bg-accent text-accent-foreground ring-accent"
                      : "bg-card text-muted-foreground ring-border hover:bg-muted"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <main className="flex-1 px-4 py-4">
        {loading && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Loading schedule…
          </p>
        )}
        {error && (
          <p className="py-12 text-center text-sm text-red-600 dark:text-red-400">
            {error} Try refreshing the page.
          </p>
        )}
        {data && !schedule && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Schedule prediction isn&apos;t available.
          </p>
        )}

        {data && schedule && (
          <>
            {/* PREDICTED disclaimer — prominent, not dismissable (PRD §11). */}
            <div
              role="note"
              className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"
            >
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-base">⚠️</span>
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  {schedule.status === "PREDICTED" ? "Predicted" : schedule.status} — not
                  official
                </h2>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/90">
                {schedule.disclaimer}
              </p>
              <p className="mt-1.5 text-xs font-medium text-amber-900/90 dark:text-amber-100/90">
                Real set times post on-site when gates open.
              </p>
            </div>

            {/* Confidence legend (PRD §11). */}
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="font-semibold">Confidence:</span>
              <span className="inline-flex items-center gap-1">
                <ConfidenceDot confidence="high" /> named headliner
              </span>
              <span className="inline-flex items-center gap-1">
                <ConfidenceDot confidence="medium" /> main-stage / high-draw
              </span>
              <span className="inline-flex items-center gap-1">
                <ConfidenceDot confidence="low" /> inferred
              </span>
            </div>

            {/* Must-see overlap warning for the active day (PRD §11 enhancement). */}
            {conflicts.size > 0 && (
              <p className="mb-4 rounded-xl bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:text-rose-300">
                ⚠ {conflicts.size} must-see time conflict
                {conflicts.size === 1 ? "" : "s"} on {activeDay} — overlapping predicted
                sets.
              </p>
            )}

            {stageGroups.length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No predicted acts for {activeDay}.
              </p>
            )}

            <div className="space-y-5">
              {stageGroups.map(({ stage, acts }) => (
                <section key={stage}>
                  <h3 className="mb-1 flex items-baseline justify-between border-b border-border pb-1">
                    <span className="text-sm font-bold">{stage}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {acts.length} {acts.length === 1 ? "act" : "acts"}
                    </span>
                  </h3>
                  <ul className="divide-y divide-border">
                    {acts.map((b) => {
                      const clash = conflicts.has(b.name);
                      const st = status[b.name];
                      return (
                        <li key={b.name}>
                          <button
                            type="button"
                            onClick={() => setSelected(b)}
                            className="flex min-h-[44px] w-full items-center gap-3 py-2 text-left hover:bg-muted/50"
                          >
                            <span className="w-[68px] shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                              {b.pred_time ?? "—"}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                              {b.name}
                            </span>
                            {clash && (
                              <span
                                title="Overlaps another must-see"
                                className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400"
                              >
                                ⚠ Clash
                              </span>
                            )}
                            {st && <StatusBadge status={st} />}
                            <ConfidenceDot confidence={b.pred_confidence} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
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
