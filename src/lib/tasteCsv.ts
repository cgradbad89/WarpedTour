// tasteCsv.ts — parse an uploaded Spotify-taste CSV into a TasteProfile (PRD §10).
//
// Expected shape (the same export the owner used): a 2-row header over 9 columns
// — three windows (Lifetime / 6 months / 1 month), each with Top Genres, Top
// artists, Top tracks. Header row 1 carries the window labels (often merged, so
// blank after the first column of each group); header row 2 carries the category
// labels. The 1-month group's columns may be SHUFFLED, so we map every column by
// DETECTING its label (artists vs genres vs tracks), never by position. Data
// rows hold ranked items ("1. Jimmy Eat World"); rank prefixes and any embedded
// sub-header rows ("Your top artists from the past 6 months") are stripped.
//
// Parsing is defensive: anything that doesn't look like the expected format
// throws a TasteCsvError with a clear, user-facing message — it never silently
// produces garbage scores (PRD §10, the task's "validate" requirement).

import { parseCsv } from "./csv";
import type { TasteProfile, TasteWindowKey } from "./scoring";

/** Thrown for any malformed/unrecognised taste CSV. `message` is user-facing. */
export class TasteCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TasteCsvError";
  }
}

type Category = "genres" | "artists" | "tracks";

/** Detect a column's category from its header label (position-independent). */
function detectCategory(s: string): Category | null {
  const t = s.toLowerCase();
  if (/genre/.test(t)) return "genres";
  if (/artist/.test(t)) return "artists";
  if (/track|song/.test(t)) return "tracks";
  return null;
}

/** Detect a window from a header label. Order matters: 6-month before 1-month. */
function detectWindow(s: string): TasteWindowKey | null {
  const t = s.toLowerCase();
  if (/life|all[\s-]*time|overall|long[\s-]*term/.test(t)) return "long_term";
  if (/6\s*month|six\s*month|6\s*mo\b|medium[\s-]*term|half[\s-]*year|26\s*week/.test(t))
    return "medium_term";
  if (/1\s*month|one\s*month|4\s*week|last\s*month|this\s*month|short[\s-]*term|recent/.test(t))
    return "short_term";
  return null;
}

/** Strip a leading rank prefix: "1. ", "2) ", "3 - ", "10: " → the bare value. */
function stripRank(s: string): string {
  return s.replace(/^\s*\d+\s*[.)\]:-]\s*/, "").trim();
}

// Embedded sub-header / descriptive rows that some exports interleave with data.
const SUBHEADER_RE =
  /^(your\s+top|top\s+(artists|genres|tracks|songs)|from\s+the\s+past|past\s+\d|all[\s-]*time|last\s+(month|year)|this\s+month|over\s+the|generated\s+|rank\b)/i;
function looksLikeSubheader(s: string): boolean {
  return SUBHEADER_RE.test(s);
}

const ALL_WINDOWS: TasteWindowKey[] = ["short_term", "medium_term", "long_term"];
// Positional fallback order when window labels aren't detectable: the task's
// stated column order is Lifetime → 6 months → 1 month.
const POSITIONAL: TasteWindowKey[] = ["long_term", "medium_term", "short_term"];

const FORMAT_HINT =
  "Expected a CSV with a 2-row header and three windows (Lifetime / 6 months / 1 month), " +
  "each with “Top Genres”, “Top artists”, and “Top tracks” columns.";

/**
 * Parse taste-CSV text into a TasteProfile. Throws TasteCsvError on anything that
 * doesn't match the expected format. `label` (e.g. the file name) is stored for
 * the "whose data is loaded" indicator.
 */
export function parseTasteCsv(text: string, label?: string): TasteProfile {
  const rows = parseCsv(text)
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== "")); // drop blank rows

  if (rows.length === 0) {
    throw new TasteCsvError(
      "That file looks empty. Export your Spotify taste as a CSV and try again.",
    );
  }

  // The category header is the first row naming BOTH an artists and a genres
  // column — a strong, position-independent signal (a data row won't contain
  // both words). The window-label row is the one directly above it.
  let catRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const cats = rows[i].map(detectCategory);
    if (cats.includes("artists") && cats.includes("genres")) {
      catRowIdx = i;
      break;
    }
  }
  if (catRowIdx === -1) {
    throw new TasteCsvError(
      `Couldn't find the header row. ${FORMAT_HINT}`,
    );
  }

  const catRow = rows[catRowIdx];
  const cats = catRow.map(detectCategory);
  const winRow = catRowIdx > 0 ? rows[catRowIdx - 1] : [];

  // Forward-fill window labels across each (often merged) window group.
  const filledWin: (TasteWindowKey | null)[] = [];
  let last: TasteWindowKey | null = null;
  for (let c = 0; c < catRow.length; c++) {
    const detected = winRow[c] ? detectWindow(winRow[c]) : null;
    if (detected) last = detected;
    filledWin[c] = detected ?? last;
  }

  // Columns we care about: those with a detected category.
  const catCols = cats
    .map((cat, c) => ({ cat, c }))
    .filter((x): x is { cat: Category; c: number } => x.cat !== null);

  // Map each category column to a window: prefer the detected/forward-filled
  // label; otherwise fall back to positional thirds (only when the column count
  // divides evenly into three windows).
  const colWindow = new Map<number, TasteWindowKey>();
  const groupSize = catCols.length / 3;
  catCols.forEach((x, idx) => {
    let win = filledWin[x.c];
    if (!win && Number.isInteger(groupSize)) {
      win = POSITIONAL[Math.min(Math.floor(idx / groupSize), 2)];
    }
    if (win) colWindow.set(x.c, win);
  });

  const windows: Record<TasteWindowKey, { artists: string[]; genres: string[] }> = {
    short_term: { artists: [], genres: [] },
    medium_term: { artists: [], genres: [] },
    long_term: { artists: [], genres: [] },
  };

  // Dedupe per (window, category), preserving rank order.
  const seen = new Map<string, Set<string>>();
  const push = (win: TasteWindowKey, cat: "artists" | "genres", value: string) => {
    const key = `${win}:${cat}`;
    let set = seen.get(key);
    if (!set) {
      set = new Set<string>();
      seen.set(key, set);
    }
    const norm = value.toLowerCase();
    if (set.has(norm)) return;
    set.add(norm);
    windows[win][cat].push(value);
  };

  for (let i = catRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    for (const { cat, c } of catCols) {
      if (cat === "tracks") continue; // tracks aren't used by scoring
      const win = colWindow.get(c);
      if (!win) continue;
      const cell = row[c];
      if (!cell) continue;
      const value = stripRank(cell);
      if (!value || looksLikeSubheader(value)) continue;
      push(win, cat, value);
    }
  }

  const totalArtists = ALL_WINDOWS.reduce((n, w) => n + windows[w].artists.length, 0);
  if (totalArtists === 0) {
    throw new TasteCsvError(
      `Found the header but no artists under it. Make sure the “Top artists” columns are filled in (one ranked artist per row). ${FORMAT_HINT}`,
    );
  }

  return { version: 1, label, windows };
}
