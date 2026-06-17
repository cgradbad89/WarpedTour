"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useExplorerData } from "@/lib/profile";
import { usePersonalState } from "@/lib/personal";
import type { Band, StatusMap } from "@/types";
import { Nav } from "@/components/Nav";
import { BandDetail } from "@/components/BandDetail";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfidenceDot } from "@/components/ConfidenceDot";

// Predicted schedule — a TIME-GRID: stages are columns, time runs top-to-bottom
// on a shared axis, so acts that start at the same time line up across columns
// (PRD §11). The pred_* fields and the top-level `schedule` block are
// TASTE-INDEPENDENT: they read straight from bands.json and survive an uploaded-
// profile re-score unchanged (rescoreDataset spreads them through), so this view
// is identical for the owner and any friend. Tapping a cell opens the shared
// BandDetail modal (which carries the predicted-slot line).

// A band is placeable on the grid only if it carries the fields we need; anything
// lacking them is silently omitted rather than crashing the page.
function hasPred(b: Band): boolean {
  return (
    typeof b.pred_day === "string" &&
    typeof b.pred_stage === "string" &&
    typeof b.pred_time_min === "number"
  );
}

// Fallback display label from minutes-since-midnight — only used if a band has a
// numeric pred_time_min but somehow no pred_time string (defensive; the dataset
// always ships both).
function minutesToLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Must-see picks on `day` whose [start, start+len) intervals overlap. Returns the
// set of band names caught in any clash — you can't be two places at once. This
// is cross-stage and exact-time-agnostic (a 6:18 act can overlap a 6:25 act), so
// it stays a real overlap test, not just a same-row check.
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

// Desktop = wide enough to show every stage as a column. Below this, the user
// picks 1–2 stages (the grid won't fit 4 columns on a phone). Matches the Tailwind
// `lg` breakpoint used for the layout below. SSR-safe: starts false (mobile-first)
// and resolves in an effect, so the server and first client render agree.
function useIsWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

const AXIS_PX = 72; // left time-axis column width (fits "12:00 PM")
const MOBILE_MAX_COLS = 2; // most stage columns shown at once on a phone

export default function SchedulePage() {
  const { data, loading, error, profile } = useExplorerData();
  const { status, changeStatus } = usePersonalState();
  const isWide = useIsWide();

  const [day, setDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<Band | null>(null);
  // Which stages the mobile picker shows. null → derive the default (first 1–2).
  const [pickedStages, setPickedStages] = useState<string[] | null>(null);

  const schedule = data?.schedule;
  const stages = useMemo(() => schedule?.stages ?? [], [schedule]);
  const days = useMemo(() => schedule?.days ?? [], [schedule]);
  const activeDay = day ?? days[0] ?? null;

  // Mobile selection (1–2 stages); defaults to the first stages in display order.
  const mobileStages = useMemo(
    () => pickedStages ?? stages.slice(0, Math.min(MOBILE_MAX_COLS, stages.length)),
    [pickedStages, stages],
  );

  // Columns actually rendered: all stages on a wide screen, the picked subset on a
  // phone. Time-axis + sorting work identically in both modes.
  const visibleStages = useMemo(
    () => (isWide ? stages : mobileStages),
    [isWide, stages, mobileStages],
  );

  // Toggle a stage in the mobile picker. Keeps 1–2 selected: tapping a third swaps
  // out the oldest; you can't deselect the last remaining column.
  const toggleStage = useCallback(
    (s: string) => {
      setPickedStages((prev) => {
        const cur = prev ?? stages.slice(0, Math.min(MOBILE_MAX_COLS, stages.length));
        if (cur.includes(s)) return cur.length === 1 ? cur : cur.filter((x) => x !== s);
        if (cur.length >= MOBILE_MAX_COLS) return [cur[cur.length - 1], s];
        return [...cur, s];
      });
    },
    [stages],
  );

  // Build the grid for the active day from the visible stages only: the shared
  // time axis is the union of those columns' start times (so no all-empty rows),
  // each cell keyed by `stage|time`. Sparse columns are expected — a stage with no
  // act at a given time renders an empty cell, keeping the other columns aligned.
  const grid = useMemo(() => {
    if (!data || !activeDay || visibleStages.length === 0) return null;
    const stageSet = new Set(visibleStages);
    const dayBands = data.bands.filter(
      (b) => hasPred(b) && b.pred_day === activeDay && stageSet.has(b.pred_stage as string),
    );
    const cell = new Map<string, Band>();
    const label = new Map<number, string>();
    const timeSet = new Set<number>();
    for (const b of dayBands) {
      const t = b.pred_time_min as number;
      timeSet.add(t);
      cell.set(`${b.pred_stage}|${t}`, b);
      if (!label.has(t)) label.set(t, b.pred_time ?? minutesToLabel(t));
    }
    const times = [...timeSet].sort((a, z) => a - z);
    return { times, cell, label };
  }, [data, activeDay, visibleStages]);

  const conflicts = useMemo(
    () =>
      data && activeDay
        ? mustConflictNames(data.bands, activeDay, status)
        : new Set<string>(),
    [data, activeDay, status],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col lg:max-w-5xl">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        {/* Shared nav strip: tabs left, account right, one pinned row. */}
        <div className="px-4 pt-3 pb-2">
          <Nav />
        </div>
        {days.length > 0 && (
          <div className="flex gap-1.5 px-4 pb-3 lg:max-w-md" role="tablist" aria-label="Day">
            {days.map((d) => {
              const active = d === activeDay;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setDay(d)}
                  className={`min-h-[44px] flex-1 rounded-xl px-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
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
            {/* Notices + mobile picker — kept phone-width and left-aligned with the
                grid even when the grid widens out on desktop. */}
            <div className="lg:max-w-2xl">
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

              {/* Must-see overlap warning for the active day (PRD §11). Counted across
                  ALL stages, so it's honest even when some columns are hidden on mobile. */}
              {conflicts.size > 0 && (
                <p className="mb-4 rounded-xl bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:text-rose-300">
                  ⚠ {conflicts.size} must-see time conflict
                  {conflicts.size === 1 ? "" : "s"} on {activeDay} — overlapping predicted
                  sets.
                </p>
              )}

              {/* Mobile stage picker — a 4-wide grid doesn't fit a phone, so the user
                  chooses which 1–2 stages are shown as columns. Hidden on desktop,
                  where every stage is a column. */}
              {stages.length > 1 && (
                <div className="mb-4 lg:hidden">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Stages — pick 1–2 to compare
                  </div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stages to show">
                    {stages.map((s) => {
                      const on = mobileStages.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleStage(s)}
                          className={`min-h-[44px] rounded-full px-3 text-sm font-semibold ring-1 ring-inset transition-colors ${
                            on
                              ? "bg-accent text-accent-foreground ring-accent"
                              : "bg-card text-muted-foreground ring-border hover:bg-muted"
                          }`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {!grid || grid.times.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No predicted acts for {activeDay}.
              </p>
            ) : (
              <div
                className="overflow-hidden rounded-xl ring-1 ring-inset ring-border"
                aria-label={`Predicted schedule grid for ${activeDay}`}
              >
                <div
                  className="grid gap-px bg-border"
                  style={{
                    gridTemplateColumns: `${AXIS_PX}px repeat(${visibleStages.length}, minmax(0, 1fr))`,
                  }}
                >
                  {/* header row: empty corner + stage names */}
                  <div className="bg-muted" aria-hidden="true" />
                  {visibleStages.map((s) => (
                    <div
                      key={`head-${s}`}
                      className="bg-muted px-2 py-2 text-xs font-bold leading-tight"
                    >
                      {s}
                    </div>
                  ))}

                  {/* one row per distinct start time; cells align across columns */}
                  {grid.times.map((t) => (
                    <Fragment key={t}>
                      <div className="flex items-center justify-end bg-muted px-2 py-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                        {grid.label.get(t)}
                      </div>
                      {visibleStages.map((s) => {
                        const b = grid.cell.get(`${s}|${t}`);
                        if (!b) {
                          return (
                            <div
                              key={`${s}|${t}`}
                              className="bg-background"
                              aria-hidden="true"
                            />
                          );
                        }
                        const clash = conflicts.has(b.name);
                        const st = status[b.name];
                        return (
                          <button
                            key={`${s}|${t}`}
                            type="button"
                            onClick={() => setSelected(b)}
                            aria-label={`${b.name} — ${s}, ${grid.label.get(t)}${
                              st ? `, marked ${st}` : ""
                            }${clash ? ", schedule conflict" : ""}`}
                            className="flex min-h-[44px] w-full flex-col justify-center gap-1 bg-card px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">
                                {b.name}
                              </span>
                              <ConfidenceDot confidence={b.pred_confidence} />
                            </span>
                            {(clash || st) && (
                              <span className="flex flex-wrap items-center gap-1">
                                {clash && (
                                  <span
                                    title="Overlaps another must-see"
                                    className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400"
                                  >
                                    ⚠ Clash
                                  </span>
                                )}
                                {st && <StatusBadge status={st} />}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
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
