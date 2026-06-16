"use client";

// Search + genre filter + sort controls for the list view, plus a "show only my
// picks" toggle (PRD §5.1). 16px control text avoids iOS focus-zoom; ≥40px targets.

export type SortKey = "match" | "name" | "genre";

export function Controls({
  search,
  onSearch,
  genre,
  onGenre,
  sort,
  onSort,
  allGenres,
  onlyPicks,
  onOnlyPicks,
}: {
  search: string;
  onSearch: (v: string) => void;
  genre: string;
  onGenre: (v: string) => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  allGenres: string[];
  onlyPicks: boolean;
  onOnlyPicks: (v: boolean) => void;
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
      <button
        type="button"
        role="switch"
        aria-checked={onlyPicks}
        onClick={() => onOnlyPicks(!onlyPicks)}
        className={`flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold ring-1 ring-inset transition-colors ${
          onlyPicks
            ? "bg-accent text-accent-foreground ring-accent"
            : "bg-card text-muted-foreground ring-border hover:bg-muted"
        }`}
      >
        <span aria-hidden="true">{onlyPicks ? "★" : "☆"}</span>
        Show only my picks
      </button>
    </div>
  );
}
