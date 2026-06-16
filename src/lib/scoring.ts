// scoring.ts — the canonical client-side re-scoring algorithm (PRD §10).
//
// THIS IS A FAITHFUL PORT of the scoring logic in scripts/refresh-data.mjs (the
// offline generator that builds the baked public/bands.json). The two must stay
// in sync: refresh-data.mjs bakes the OWNER's bands.json; this module re-scores
// those same bands live, in the browser, against a FRIEND's uploaded taste
// profile — no backend, no API calls (PRD §10, CLAUDE.md "Key Constraints").
//
// Only the taste-DEPENDENT fields are recomputed here (score, bucket,
// match_kind, why, similar_you_listen, similar_general, genre_overlap, and the
// personalised tail of `bio`). Every taste-INDEPENDENT field (genres, raw_tags,
// top_track, preview_url, image, fans, deezer_id, spotify_*, the factual part of
// `bio`) is reused verbatim from the baked band.
//
// The ONLY similar-artist material available at runtime is what bands.json
// already stores (similar_you_listen ∪ similar_general). Some bands have thin
// similar lists, so a friend's re-scored matches are bounded by that data — an
// honest caveat surfaced in the UI (PRD §10, §6).

import type { Band, BandsDataset, MatchKind } from "@/types";

// ---------------------------------------------------------------------------
// Constants (mirrored from scripts/refresh-data.mjs)
// ---------------------------------------------------------------------------

/** Bucket labels in display order (mirrors Dataset.buckets / the generator). */
export const BUCKETS = [
  "In your rotation",
  "Must see",
  "High match",
  "Long shot",
  "Discovery",
] as const;

/**
 * Recency weights from the generator. The cascade below ENCODES these as fixed
 * tier scores (1-month → 5.0, 6-month/lifetime → 4.5, …) rather than multiplying
 * by them, exactly as refresh-data.mjs does — kept here for parity/reference.
 */
export const WINDOW_WEIGHT = { now: 1.0, sixmo: 0.7, life: 0.55 } as const;

// Raw genre/tag → parent bucket. First matching rule wins, so order matters:
// more specific genres precede the broad ones they contain. Identical to the
// generator's GENRE_RULES.
const GENRE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/metalcore|deathcore/, "metalcore"],
  [/post[- ]?hardcore/, "post-hardcore"],
  [/pop[- ]?punk/, "pop punk"],
  [/emo|screamo|emocore/, "emo"],
  [/\bska\b|two[- ]?tone/, "ska"],
  [/hardcore|\bhxc\b/, "hardcore"],
  [/metal|thrash|doom|grindcore|djent/, "metal"],
  [/punk|\boi!?\b/, "punk"],
  [/hip[- ]?hop|\brap\b|trap/, "hip hop"],
  [/electronic|\bedm\b|techno|house|dubstep|synth|electro|\bdance\b|industrial/, "electronic"],
  [/\bpop\b|powerpop|power pop/, "pop"],
  [/indie|alternative|alt[- ]?rock|grunge|shoegaze|post[- ]?punk/, "alternative"],
  [/rock/, "rock"],
];

// The exact personalised sentence the generator appends to a band's bio for an
// owner "direct-now" match. We strip it on re-score so a friend never sees the
// owner's personalisation, and re-append it only when the band is in the
// FRIEND's own current rotation. (It is the only personalised bio tail the
// generator ever produces — see scripts/refresh-data.mjs buildBand.)
const OWNER_BIO_SUFFIX =
  " This one's in heavy rotation for you right now — prioritize it.";

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Loose artist-name key for matching: NFKD-decompose (so accented letters split
 * into base + combining mark), lowercase, then drop everything non-alphanumeric —
 * which also discards the combining marks, spaces, and punctuation. So
 * "Panic! At The Disco"
 * ↔ "panic at the disco", "Mötley Crüe" ↔ "motley crue", "blink-182" ↔
 * "Blink 182". Slightly more lenient than the generator's plain lowercase, but
 * applied symmetrically to both the band side and the taste side, and only on
 * the re-score path (the default owner view reads bands.json verbatim).
 */
export function normalizeArtist(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Genre key: lowercase + trim (matches the generator's exact-string genre match). */
function normalizeGenre(s: string): string {
  return s.toLowerCase().trim();
}

/** Dedupe names by their artist key, preserving first-seen order and casing. */
function dedupeArtists(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = normalizeArtist(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Genre collapse + bucket + reason (ports of the generator's helpers)
// ---------------------------------------------------------------------------

/** Collapse raw genre/tag names to up to 3 ordered parent genres (contract: 1–3). */
export function collapseGenres(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const t = raw.toLowerCase();
    for (const [re, parent] of GENRE_RULES) {
      if (re.test(t)) {
        counts.set(parent, (counts.get(parent) ?? 0) + 1);
        break;
      }
    }
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  return ordered.length ? ordered.slice(0, 3) : ["rock"];
}

export function bucketForScore(score: number): string {
  if (score >= 5.0) return "In your rotation";
  if (score >= 4.5) return "Must see";
  if (score >= 3.5) return "High match";
  if (score >= 1.5) return "Long shot";
  return "Discovery";
}

function whyFor(matchKind: MatchKind, similarYouListen: string[]): string {
  switch (matchKind) {
    case "direct-now":
      return "You've had this on repeat in the last month.";
    case "direct-6mo":
      return "A regular in your rotation over the last six months.";
    case "direct-life":
      return "A longtime favorite in your library.";
    case "similar": {
      const names = similarYouListen.slice(0, 2).join(" and ");
      return `Similar to ${names}, who you already listen to.`;
    }
    case "genre":
      return "Matches genres you gravitate toward.";
    case "scene":
      return "From a scene close to what you listen to.";
    default:
      return "A discovery pick outside your usual rotation.";
  }
}

/** Strip the owner's personalised bio tail; re-add it only for a friend direct-now. */
function rescoreBio(bio: string, matchKind: MatchKind): string {
  const factual = bio.endsWith(OWNER_BIO_SUFFIX)
    ? bio.slice(0, -OWNER_BIO_SUFFIX.length)
    : bio;
  return matchKind === "direct-now" ? factual + OWNER_BIO_SUFFIX : factual;
}

// ---------------------------------------------------------------------------
// Taste profile → matching sets
// ---------------------------------------------------------------------------

export type TasteWindowKey = "short_term" | "medium_term" | "long_term";

export interface TasteWindow {
  /** Ordered top-artist names for the window (rank-ordered as exported). */
  artists: string[];
  /** Associated top-genre labels for the window. */
  genres: string[];
}

/**
 * An uploaded taste profile — the parsed per-window artist/genre lists. Stored
 * in localStorage under `warped2026:profile` (PRD §4.3). Holds raw names (so it
 * stays human-inspectable and re-normalisable); normalisation happens here at
 * scoring time. Windows map to Spotify ranges: short_term ≈ 1 month,
 * medium_term ≈ 6 months, long_term ≈ lifetime.
 */
export interface TasteProfile {
  version: 1;
  /** Optional human label (e.g. the uploaded file name) for the "whose view" UI. */
  label?: string;
  windows: Record<TasteWindowKey, TasteWindow>;
}

interface Taste {
  now: Set<string>;
  sixmo: Set<string>;
  life: Set<string>;
  allArtists: Set<string>;
  genres: Set<string>;
}

/** Build the normalised matching sets the cascade reads (mirrors readTaste). */
export function buildTaste(profile: TasteProfile): Taste {
  const w = profile.windows;
  const artistSet = (k: TasteWindowKey) =>
    new Set((w[k]?.artists ?? []).map(normalizeArtist).filter(Boolean));

  const now = artistSet("short_term");
  const sixmo = artistSet("medium_term");
  const life = artistSet("long_term");
  const allArtists = new Set<string>([...now, ...sixmo, ...life]);
  const genres = new Set<string>(
    (["short_term", "medium_term", "long_term"] as TasteWindowKey[])
      .flatMap((k) => w[k]?.genres ?? [])
      .map(normalizeGenre)
      .filter(Boolean),
  );
  return { now, sixmo, life, allArtists, genres };
}

// ---------------------------------------------------------------------------
// Per-band re-score
// ---------------------------------------------------------------------------

/**
 * Re-score one baked band against a friend's taste. Returns a NEW band with the
 * taste-dependent fields recomputed and every frozen field carried through. The
 * cascade and tier scores are identical to scripts/refresh-data.mjs scoreBand().
 */
export function rescoreBand(band: Band, taste: Taste): Band {
  // Reconstruct the band's Deezer "related" pool from the two stored halves.
  // (For the owner these were split into in-library / not-in-library; their
  // union is the best available approximation of the original related list —
  // the only similar-artist material we have at runtime.)
  const pool = dedupeArtists([...band.similar_you_listen, ...band.similar_general]);

  const similarYouListen = pool.filter((r) => taste.allArtists.has(normalizeArtist(r)));
  const similarGeneral = pool
    .filter((r) => !taste.allArtists.has(normalizeArtist(r)))
    .slice(0, 6);

  // Genre overlap from the band's raw tags (closest stored proxy for the
  // generator's MusicBrainz genre/tag names) ∩ the user's genres.
  const bandGenres = [...new Set(band.raw_tags.map(normalizeGenre))].filter(Boolean);
  const genreOverlap = bandGenres.filter((g) => taste.genres.has(g)).slice(0, 6);

  // Parent-genre adjacency → "scene". band.genres is already the generator's
  // collapsed parents (taste-independent), so reuse it directly.
  const tasteParents = collapseGenres([...taste.genres]);
  const parentAdjacent = band.genres.some((p) => tasteParents.includes(p));

  const key = normalizeArtist(band.name);
  let score: number;
  let matchKind: MatchKind;
  if (taste.now.has(key)) {
    score = 5.0;
    matchKind = "direct-now";
  } else if (taste.sixmo.has(key)) {
    score = 4.5;
    matchKind = "direct-6mo";
  } else if (taste.life.has(key)) {
    score = 4.5;
    matchKind = "direct-life";
  } else if (similarYouListen.length > 0) {
    score =
      similarYouListen.length >= 3 ? 4.5 : similarYouListen.length === 2 ? 4.0 : 3.5;
    matchKind = "similar";
  } else if (genreOverlap.length > 0) {
    score = 1.5;
    matchKind = "genre";
  } else if (parentAdjacent) {
    score = 2.0;
    matchKind = "scene";
  } else {
    score = 1.0;
    matchKind = "none";
  }

  // Tiny genre floor: a strong genre overlap nudges an otherwise-low pick up.
  if (matchKind === "genre" && genreOverlap.length >= 3) score = 2.0;

  return {
    ...band,
    score,
    bucket: bucketForScore(score),
    match_kind: matchKind,
    why: whyFor(matchKind, similarYouListen),
    similar_you_listen: similarYouListen.slice(0, 8),
    similar_general: similarGeneral,
    genre_overlap: genreOverlap,
    bio: rescoreBio(band.bio, matchKind),
  };
}

/**
 * Re-score a whole dataset against a profile. When `profile` is null, returns
 * the original dataset UNCHANGED (same reference) so the owner's default view is
 * byte-for-byte identical. Otherwise returns a new dataset whose bands are
 * re-scored and re-sorted best-first (matching the baked file's canonical order
 * and the generator's final sort).
 */
export function rescoreDataset(
  dataset: BandsDataset,
  profile: TasteProfile | null,
): BandsDataset {
  if (!profile) return dataset;
  const taste = buildTaste(profile);
  const bands = dataset.bands
    .map((b) => rescoreBand(b, taste))
    .sort((a, b) => b.score - a.score || b.fans - a.fans || a.name.localeCompare(b.name));
  return { ...dataset, bands };
}
