// TypeScript interfaces mirroring public/bands.json (PRD §3).
// Single source of truth for the data contract inside the app.
// If the band object shape changes, update this file, scripts/refresh-data.mjs,
// and PRD.md §3 together (CLAUDE.md "Data File Rules").

/**
 * Reason a band got its score (PRD §3.2). `direct-6mo` is part of the contract
 * even though the current dataset happens not to contain any.
 */
export type MatchKind =
  | "direct-now"
  | "direct-6mo"
  | "direct-life"
  | "similar"
  | "genre"
  | "scene"
  | "none";

/** One band — every field is present on every band in the dataset. */
export interface Band {
  name: string;
  /** 1.0–5.0 in half-point steps. */
  score: number;
  /** Human label for the score tier (one of Dataset.buckets). */
  bucket: string;
  match_kind: MatchKind;
  /** One-line plain-English reason for the score. */
  why: string;
  /** 1–3 collapsed parent genres (each a member of Dataset.all_genres). */
  genres: string[];
  /** Up to 6 raw MusicBrainz tags. */
  raw_tags: string[];
  bio: string;
  /** Similar artists that ARE in my library (the persuasive list). */
  similar_you_listen: string[];
  /** Similar artists NOT in my library. */
  similar_general: string[];
  /** My genres this band matches. */
  genre_overlap: string[];
  top_track: string | null;
  /** 30-sec MP3 preview (Deezer CDN, https). Empty string if none (1 band). */
  preview_url: string;
  album: string;
  /** Artist image URL (Deezer CDN, https, 250px). Empty string if none. */
  image: string;
  fans: number;
  deezer_id: number | null;
  /** `spotify:search:<name>` — opens the Spotify app. */
  spotify_search_uri: string;
  /** `https://open.spotify.com/search/<name>` — browser fallback. */
  spotify_web_url: string;
  /**
   * Frozen `null` artifact of the data build. DO NOT read or write it —
   * all personal state lives in localStorage (PRD §4, §6).
   */
  user_status: null;
}

export interface EventInfo {
  name: string;
  dates: string;
  venue: string;
  band_count: number;
}

export interface Scoring {
  windows: string[];
  method: string;
  note: string;
}

/** Top-level shape of public/bands.json. */
export interface BandsDataset {
  event: EventInfo;
  scoring: Scoring;
  /** The 13 filterable parent genres. */
  all_genres: string[];
  /** Bucket labels, in display order. */
  buckets: string[];
  bands: Band[];
}

/** Personal status — localStorage only (PRD §4). */
export type BandStatus = "must" | "maybe" | "skip";

/** `{ [bandName]: status }`. Absence of a key = unset. localStorage `warped2026:status`. */
export type StatusMap = Record<string, BandStatus>;

/**
 * Manual per-section ordering for the My Picks page — localStorage key
 * `warped2026:order` (PRD §4). Each value is an ordered list of band names for
 * that status section. A name absent from the array (or a missing key) falls
 * back to score order (desc, ties by fans desc). Keyed by name so a bands.json
 * refresh never orphans entries by id.
 */
export type OrderMap = Partial<Record<BandStatus, string[]>>;
