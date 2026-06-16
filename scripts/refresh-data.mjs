#!/usr/bin/env node
/**
 * refresh-data.mjs — regenerates public/bands.json (PRD §8, CLAUDE.md).
 *
 * WHAT IT DOES
 *   Rebuilds the canonical data layer from two committed inputs:
 *     scripts/lineup.txt        one band name per line ("#" lines ignored)
 *     scripts/taste_multi.json  my 3-window Spotify export (1mo / 6mo / lifetime)
 *   For each band it enriches via two KEYLESS public APIs and scores it against
 *   my taste, then writes the full dataset to public/bands.json.
 *
 * HOW TO RUN  (manual, and only when a task authorizes a refresh)
 *     node scripts/refresh-data.mjs
 *   Node 18+ (built-in fetch). No API keys, no env vars. Takes a few minutes —
 *   MusicBrainz is throttled to ≤1 request/second (see below).
 *
 * SANITY-CHECK BEFORE COMMITTING (PRD §8.2)
 *   - band count is plausible
 *   - ~all bands have a preview_url
 *   - score distribution is NOT entirely 1.0 (all-1.0 ⇒ taste export failed to parse)
 *
 * DATA SOURCES (both keyless)
 *   Deezer       api.deezer.com — artist search, fans, image, related artists,
 *                top track + 30-sec preview. No documented hard rate limit; we
 *                still pace politely.
 *   MusicBrainz  musicbrainz.org/ws/2 — genre tags/genres + country + begin year.
 *                HARD RULE: ≤1 request/second AND a descriptive User-Agent.
 *                Do NOT parallelize MusicBrainz calls.
 *
 * If you change the band object shape, update src/types/index.ts and PRD.md §3
 * in the same commit (CLAUDE.md "Data File Rules").
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LINEUP_PATH = path.join(__dirname, "lineup.txt");
const TASTE_PATH = path.join(__dirname, "taste_multi.json");
const OUT_PATH = path.join(ROOT, "public", "bands.json");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Event metadata is not derivable from the inputs — edit here if it changes.
const EVENT = {
  name: "Vans Warped Tour — Long Beach 2026",
  dates: "July 25–26, 2026",
  venue: "Shoreline Waterfront, Long Beach, CA",
};

const SCORING = {
  windows: ["1 month (weight 1.0)", "6 months (0.7)", "lifetime (0.55)"],
  method:
    "Recency-weighted artist match (dominant) + genre floor. Similar artists via Deezer, genre tags via MusicBrainz, previews via Deezer.",
  note: "5.0 = currently in your rotation; 4.5 = must-see by taste; lower = exploratory.",
};

// Recency weights (PRD §8.1). The dominant signal is a direct artist match;
// the window it matches in sets the tier.
const WINDOW_WEIGHT = { now: 1.0, sixmo: 0.7, life: 0.55 };

// The 13 filterable parent genres (PRD §3.1). Order is the canonical filter order.
const ALL_GENRES = [
  "alternative", "electronic", "emo", "hardcore", "hip hop", "metal",
  "metalcore", "pop", "pop punk", "post-hardcore", "punk", "rock", "ska",
];

// Bucket labels in display order (PRD §3.1).
const BUCKETS = ["In your rotation", "Must see", "High match", "Long shot", "Discovery"];

// MusicBrainz politeness. A descriptive User-Agent is REQUIRED.
const MB_USER_AGENT =
  "WarpedTourBandExplorer/1.0 (https://github.com/cgradbad89/WarpedTour)";
const MB_MIN_INTERVAL_MS = 1100; // ≤1 req/sec, with headroom
const DEEZER_PACE_MS = 120; // be polite; Deezer has no hard documented limit

// Raw genre/tag → parent bucket. First matching rule wins, so order matters:
// more specific genres are listed before the broad ones they contain.
const GENRE_RULES = [
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

// Minimal ISO-3166 country-code → name map for bios (extend as needed).
const COUNTRY_NAMES = {
  US: "United States", GB: "the United Kingdom", CA: "Canada", AU: "Australia",
  DE: "Germany", SE: "Sweden", JP: "Japan", FR: "France", IT: "Italy",
  NL: "the Netherlands", BR: "Brazil", MX: "Mexico", ES: "Spain", NO: "Norway",
  FI: "Finland", IE: "Ireland", NZ: "New Zealand",
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { headers = {}, retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) return null; // 404 etc. — treat as "not found"
      return await res.json();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`  ! fetch failed (${url}): ${err.message}`);
        return null;
      }
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
}

function spotifyUris(name) {
  const q = encodeURIComponent(name);
  return {
    spotify_search_uri: `spotify:search:${q}`,
    spotify_web_url: `https://open.spotify.com/search/${q}`,
  };
}

/** Collapse raw genre/tag names to up to 3 ordered parent genres. */
function collapseGenres(names) {
  const counts = new Map();
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
  return ordered.length ? ordered.slice(0, 3) : ["rock"]; // contract: 1–3 genres
}

function bucketForScore(score) {
  if (score >= 5.0) return "In your rotation";
  if (score >= 4.5) return "Must see";
  if (score >= 3.5) return "High match";
  if (score >= 1.5) return "Long shot";
  return "Discovery";
}

function whyFor(matchKind, similarYouListen) {
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

// ---------------------------------------------------------------------------
// Deezer (keyless)
// ---------------------------------------------------------------------------

async function deezerArtist(name) {
  const search = await fetchJson(
    `https://api.deezer.com/search/artist?limit=1&q=${encodeURIComponent(name)}`,
  );
  const hit = search?.data?.[0];
  if (!hit) return null;
  await sleep(DEEZER_PACE_MS);

  const relatedRes = await fetchJson(
    `https://api.deezer.com/artist/${hit.id}/related?limit=20`,
  );
  await sleep(DEEZER_PACE_MS);

  const topRes = await fetchJson(`https://api.deezer.com/artist/${hit.id}/top?limit=1`);
  await sleep(DEEZER_PACE_MS);

  const top = topRes?.data?.[0] ?? null;
  return {
    id: hit.id,
    fans: hit.nb_fan ?? 0,
    image: hit.picture_medium || hit.picture_big || hit.picture || "",
    related: (relatedRes?.data ?? []).map((a) => a.name),
    top_track: top?.title ?? null,
    album: top?.album?.title ?? "",
    preview_url: top?.preview ?? "",
  };
}

// ---------------------------------------------------------------------------
// MusicBrainz (keyless, ≤1 req/sec, descriptive User-Agent, NOT parallelized)
// ---------------------------------------------------------------------------

let mbLastCall = 0;
async function mbFetch(url) {
  const wait = MB_MIN_INTERVAL_MS - (Date.now() - mbLastCall);
  if (wait > 0) await sleep(wait);
  mbLastCall = Date.now();
  return fetchJson(url, { headers: { "User-Agent": MB_USER_AGENT } });
}

async function musicbrainzArtist(name) {
  const search = await mbFetch(
    `https://musicbrainz.org/ws/2/artist?fmt=json&limit=1&query=artist:${encodeURIComponent(
      `"${name}"`,
    )}`,
  );
  const hit = search?.artists?.[0];
  if (!hit) return { tags: [], genres: [], country: "", begin: "" };

  const detail = await mbFetch(
    `https://musicbrainz.org/ws/2/artist/${hit.id}?fmt=json&inc=tags+genres`,
  );
  const tags = (detail?.tags ?? [])
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((t) => t.name);
  const genres = (detail?.genres ?? [])
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((g) => g.name);

  const countryCode = hit.country ?? detail?.country ?? "";
  const country =
    hit.area?.name || COUNTRY_NAMES[countryCode] || countryCode || "";
  const begin = (hit["life-span"]?.begin ?? "").slice(0, 4);
  return { tags, genres, country, begin };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// NOTE: src/lib/scoring.ts is a faithful TypeScript PORT of this scoring logic
// (constants, GENRE_RULES, the cascade, bucketForScore, whyFor). This file bakes
// the OWNER's bands.json offline; scoring.ts re-scores those same bands live in
// the browser against a friend's uploaded taste (PRD §10). If you change the
// algorithm here, mirror it in scoring.ts (and update its tests) in the same
// commit — they are intentionally two copies of one algorithm.

/**
 * Score one band against my taste. Dominant signal is a direct artist match
 * (the recency window sets the tier); then a "similar artist I listen to"
 * match; then a genre floor; "scene" adjacency; else discovery.
 */
function scoreBand({ name, related, bandGenreNames, taste }) {
  const lname = name.toLowerCase();
  const relatedLower = related.map((r) => r.toLowerCase());

  // similar artists split by whether they're in my library
  const similar_you_listen = related.filter((r) => taste.allArtists.has(r.toLowerCase()));
  const similar_general = related
    .filter((r) => !taste.allArtists.has(r.toLowerCase()))
    .slice(0, 6);

  // genres this band shares with my taste (specific names)
  const bandGenreSet = [...new Set(bandGenreNames.map((g) => g.toLowerCase()))];
  const genre_overlap = bandGenreSet.filter((g) => taste.genres.has(g)).slice(0, 6);

  // parent-genre adjacency (looser than exact overlap) → "scene"
  const bandParents = collapseGenres(bandGenreNames);
  const tasteParents = collapseGenres([...taste.genres]);
  const parentAdjacent = bandParents.some((p) => tasteParents.includes(p));

  let score;
  let match_kind;
  if (taste.now.has(lname)) {
    score = 5.0;
    match_kind = "direct-now";
  } else if (taste.sixmo.has(lname)) {
    score = 4.5;
    match_kind = "direct-6mo";
  } else if (taste.life.has(lname)) {
    score = 4.5;
    match_kind = "direct-life";
  } else if (similar_you_listen.length > 0) {
    // strength scales with how many of my artists list this band as similar
    score = similar_you_listen.length >= 3 ? 4.5 : similar_you_listen.length === 2 ? 4.0 : 3.5;
    match_kind = "similar";
  } else if (genre_overlap.length > 0) {
    score = 1.5;
    match_kind = "genre";
  } else if (parentAdjacent) {
    score = 2.0;
    match_kind = "scene";
  } else {
    score = 1.0;
    match_kind = "none";
  }

  // tiny genre floor: a strong genre overlap nudges an otherwise-low pick up
  if (match_kind === "genre" && genre_overlap.length >= 3) score = 2.0;

  void relatedLower; // reserved for future fuzzy matching
  return {
    score,
    match_kind,
    bucket: bucketForScore(score),
    why: whyFor(match_kind, similar_you_listen),
    similar_you_listen: similar_you_listen.slice(0, 8),
    similar_general,
    genre_overlap,
  };
}

// ---------------------------------------------------------------------------
// Per-band build
// ---------------------------------------------------------------------------

async function buildBand(name, taste) {
  const dz = await deezerArtist(name);
  const mb = await musicbrainzArtist(name);

  const rawTagNames = mb.tags.length ? mb.tags : mb.genres;
  const raw_tags = rawTagNames.slice(0, 6);
  const genres = collapseGenres([...mb.genres, ...mb.tags]);

  const scored = scoreBand({
    name,
    related: dz?.related ?? [],
    bandGenreNames: [...mb.genres, ...mb.tags],
    taste,
  });

  const primary = genres[0] ?? "music";
  const origin = mb.country || "parts unknown";
  let bio = `${name} is a ${primary} act from ${origin}`;
  bio += mb.begin ? `, active since ${mb.begin}.` : ".";
  if (scored.match_kind === "direct-now") {
    bio += " This one's in heavy rotation for you right now — prioritize it.";
  }

  return {
    name,
    score: scored.score,
    bucket: scored.bucket,
    match_kind: scored.match_kind,
    why: scored.why,
    genres,
    raw_tags,
    bio,
    similar_you_listen: scored.similar_you_listen,
    similar_general: scored.similar_general,
    genre_overlap: scored.genre_overlap,
    top_track: dz?.top_track ?? null,
    preview_url: dz?.preview_url ?? "",
    album: dz?.album ?? "",
    image: dz?.image ?? "",
    fans: dz?.fans ?? 0,
    deezer_id: dz?.id ?? null,
    ...spotifyUris(name),
    user_status: null,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

async function readLineup() {
  const text = await readFile(LINEUP_PATH, "utf8");
  const seen = new Set();
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim();
    if (!name || name.startsWith("#")) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

async function readTaste() {
  const raw = JSON.parse(await readFile(TASTE_PATH, "utf8"));
  const w = raw.windows ?? {};
  const artistsOf = (k) => (w[k]?.artists ?? []).map((s) => String(s).toLowerCase());
  const genresOf = (k) => (w[k]?.genres ?? []).map((s) => String(s).toLowerCase());
  const now = new Set(artistsOf("short_term"));
  const sixmo = new Set(artistsOf("medium_term"));
  const life = new Set(artistsOf("long_term"));
  const allArtists = new Set([...now, ...sixmo, ...life]);
  const genres = new Set([
    ...genresOf("short_term"),
    ...genresOf("medium_term"),
    ...genresOf("long_term"),
  ]);
  return { now, sixmo, life, allArtists, genres };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [lineup, taste] = await Promise.all([readLineup(), readTaste()]);
  if (lineup.length === 0) throw new Error("lineup.txt has no band names.");
  if (taste.allArtists.size === 0) {
    console.warn(
      "! taste_multi.json has no artists — every score will be a genre/discovery floor. " +
        "Did the export parse? (PRD §8.2)",
    );
  }
  console.log(`Building ${lineup.length} bands…`);

  const bands = [];
  for (let i = 0; i < lineup.length; i++) {
    const name = lineup[i];
    process.stdout.write(`  [${i + 1}/${lineup.length}] ${name} … `);
    try {
      const band = await buildBand(name, taste);
      bands.push(band);
      console.log(`${band.score.toFixed(1)} ${band.preview_url ? "♪" : "—"}`);
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
  }

  // Canonical order: best matches first (the app re-sorts client-side anyway).
  bands.sort((a, b) => b.score - a.score || b.fans - a.fans || a.name.localeCompare(b.name));

  const dataset = {
    event: { ...EVENT, band_count: bands.length },
    scoring: SCORING,
    all_genres: ALL_GENRES,
    buckets: BUCKETS,
    bands,
  };

  await writeFile(OUT_PATH, JSON.stringify(dataset, null, 2) + "\n", "utf8");

  const withPreview = bands.filter((b) => b.preview_url).length;
  const allOnes = bands.length > 0 && bands.every((b) => b.score === 1.0);
  console.log(`\nWrote ${bands.length} bands → ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`  previews: ${withPreview}/${bands.length}`);
  if (allOnes) {
    console.warn("  ! WARNING: every score is 1.0 — taste export likely failed to parse.");
  }
}

main().catch((err) => {
  console.error("refresh-data failed:", err);
  process.exitCode = 1;
});
