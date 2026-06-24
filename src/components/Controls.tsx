"use client";

// Search + genre filter + sort controls for the list view, plus a Sat/Sun day
// filter and a "show only my picks" toggle (PRD §5.1). The day filter composes
// with all the others (it's an additional filter, not a replacement). 16px
// control text avoids iOS focus-zoom; ≥44px targets.

import { DayFilter } from "./DayFilter";

export type SortKey = "match" | "name" | "genre";

export function Controls({
  search,
  onSearch,
  genre,
  onGenre,
  sort,
  onSort,
  allGenres,
  days,
  day,
  onDay,
  onlyPicks,
  onOnlyPicks,
  pickCount,
  onClearPicks,
}: {
  search: string;
  onSearch: (v: string) => void;
  genre: string;
  onGenre: (v: string) => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  allGenres: string[];
  /** Day labels from schedule.days; empty if the dataset has no schedule. */
  days: string[];
  /** Selected day (full label) or null for "All days". */
  day: string | null;
  onDay: (v: string | null) => void;
  onlyPicks: boolean;
  onOnlyPicks: (v: boolean) => void;
  pickCount: number;
  onClearPicks: () => void;
}) {
  const field =
    "h-11 w-full rounded-xl border border-border bg-card px-3 text-base outline-none focus:ring-2 focus:ring-accent";

  return (
    <div className="space-y-2 px-4 pb-3">
      <input
        type="search"
        inputMode="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search bands…"
        aria-label="Search bands by name"
        className={field}
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="sr-only" htmlFor="genre-filter">
          Filter by genre
        </label>
        <select
          id="genre-filter"
          value={genre}
          onChange={(e) => onGenre(e.target.value)}
          className={field}
        >
          <option value="">All genres</option>
          {allGenres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="sort-by">
          Sort by
        </label>
        <select
          id="sort-by"
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
          className={field}
        >
          <option value="match">Match (high → low)</option>
          <option value="name">Name (A–Z)</option>
          <option value="genre">Genre</option>
        </select>
      </div>
      {/* Sat/Sun day filter — schedule data, composes with search/genre/sort/
          only-picks. Hidden if the dataset ships no schedule days. */}
      <DayFilter days={days} value={day} onChange={onDay} />
      {/* Only-my-picks toggle (flex-grow) + Clear, side by side — Clear lives next
          to the filters it relates to, not floating in the nav zone. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={onlyPicks}
          onClick={() => onOnlyPicks(!onlyPicks)}
          className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold ring-1 ring-inset transition-colors ${
            onlyPicks
              ? "bg-accent text-accent-foreground ring-accent"
              : "bg-card text-muted-foreground ring-border hover:bg-muted"
          }`}
        >
          <span aria-hidden="true">{onlyPicks ? "★" : "☆"}</span>
          Only my picks
        </button>
        {pickCount > 0 && (
          <button
            type="button"
            onClick={onClearPicks}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border transition-colors hover:bg-muted"
          >
            Clear ({pickCount})
          </button>
        )}
      </div>
    </div>
  );
}
