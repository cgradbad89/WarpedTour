"use client";

import { useMemo, useState } from "react";
import { useExplorerData } from "@/lib/profile";
import { usePersonalState } from "@/lib/personal";
import type { Band } from "@/types";
import { Controls, type SortKey } from "@/components/Controls";
import { Nav } from "@/components/Nav";
import { ProfileBar } from "@/components/ProfileBar";
import { BandRow } from "@/components/BandRow";
import { BandDetail } from "@/components/BandDetail";

export default function Home() {
  const { data, loading, error, profile, setProfile, clearProfile } = useExplorerData();
  const { status, changeStatus, clearAll, pickCount } = usePersonalState();

  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("");
  const [sort, setSort] = useState<SortKey>("match");
  const [onlyPicks, setOnlyPicks] = useState(false);
  const [selected, setSelected] = useState<Band | null>(null);

  const clearPicks = () => {
    if (pickCount === 0) return;
    if (!window.confirm("Clear all your picks? This can't be undone.")) return;
    clearAll();
  };

  // Filter (search + genre + only-picks) then sort. Match-sort ties by fans desc.
  const visible = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const list = data.bands.filter(
      (b) =>
        (q === "" || b.name.toLowerCase().includes(q)) &&
        (genre === "" || b.genres.includes(genre)) &&
        (!onlyPicks || status[b.name] !== undefined),
    );
    const sorted = [...list];
    if (sort === "match") {
      sorted.sort((a, b) => b.score - a.score || b.fans - a.fans);
    } else if (sort === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort(
        (a, b) =>
          (a.genres[0] ?? "").localeCompare(b.genres[0] ?? "") ||
          a.name.localeCompare(b.name),
      );
    }
    return sorted;
  }, [data, search, genre, sort, onlyPicks, status]);

  // Group under bucket headers only when sorted by Match (PRD §5.1).
  const grouped = useMemo(() => {
    if (!data || sort !== "match") return null;
    return data.buckets
      .map((bucket) => ({
        bucket,
        bands: visible.filter((b) => b.bucket === bucket),
      }))
      .filter((g) => g.bands.length > 0);
  }, [data, visible, sort]);

  const total = data?.bands.length ?? 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          {pickCount > 0 && (
            <button
              type="button"
              onClick={clearPicks}
              className="min-h-[40px] shrink-0 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted"
            >
              Clear picks ({pickCount})
            </button>
          )}
          <div className="ml-auto">
            <Nav />
          </div>
        </div>
        <div className="px-4 pb-2">
          <h1 className="text-base font-extrabold leading-tight">
            {data?.event.name ?? "Vans Warped Tour — Long Beach 2026"}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data
              ? `${data.event.dates} · ${data.event.venue}`
              : "July 25–26, 2026"}
          </p>
          {data && (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {visible.length} {visible.length === 1 ? "band" : "bands"}
              {visible.length !== total ? ` of ${total}` : ""}
            </p>
          )}
        </div>
        <ProfileBar
          profile={profile}
          onSetProfile={setProfile}
          onClearProfile={clearProfile}
        />
        {data && (
          <Controls
            search={search}
            onSearch={setSearch}
            genre={genre}
            onGenre={setGenre}
            sort={sort}
            onSort={setSort}
            allGenres={data.all_genres}
            onlyPicks={onlyPicks}
            onOnlyPicks={setOnlyPicks}
          />
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
        {data && visible.length === 0 && (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            {onlyPicks && pickCount === 0
              ? "You haven't marked any bands yet."
              : "No bands match your filters."}
          </p>
        )}

        {data && grouped
          ? grouped.map((g) => (
              <section key={g.bucket}>
                <h2 className="bg-muted px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {g.bucket}{" "}
                  <span className="font-normal normal-case">({g.bands.length})</span>
                </h2>
                <ul className="divide-y divide-border">
                  {g.bands.map((b) => (
                    <li key={b.name}>
                      <BandRow
                        band={b}
                        status={status[b.name]}
                        onOpen={setSelected}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          : data && (
              <ul className="divide-y divide-border">
                {visible.map((b) => (
                  <li key={b.name}>
                    <BandRow
                      band={b}
                      status={status[b.name]}
                      onOpen={setSelected}
                    />
                  </li>
                ))}
              </ul>
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
