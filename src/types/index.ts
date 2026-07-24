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

/**
 * Confidence in a band's PREDICTED schedule slot (PRD §11): high = named
 * headliner, medium = main-stage/high-draw, low = inferred.
 */
export type PredConfidence = "high" | "medium" | "low";

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

  // --- Predicted schedule (PRD §11) — HEURISTIC, not official set times. ---
  // Present on every band in the current dataset, but typed OPTIONAL so the
  // Schedule grid degrades gracefully if a future band ever lacks them.
  /** Predicted stage label (one of `Schedule.stages`), e.g. "Mainstage". */
  pred_stage?: string;
  /** Predicted day label (one of `Schedule.days`), e.g. "Sat Jul 25". */
  pred_day?: string;
  /** Predicted start time as a display string, e.g. "6:18 PM". */
  pred_time?: string;
  /** Predicted start in minutes since midnight (e.g. 1098 = 6:18 PM). Sort key. */
  pred_time_min?: number;
  /** Predicted set length in minutes. */
  pred_setlen_min?: number;
  /** Confidence in this prediction. */
  pred_confidence?: PredConfidence;

  /**
   * Frozen `null` artifact of the data build. DO NOT read or write it —
   * all personal state lives in localStorage (PRD §4, §6).
   */
  user_status: null;
}

/**
 * Top-level PREDICTED schedule block (PRD §11). Heuristic stage/day/time
 * assignments — NOT official set times. `real_times_available` flips to `true`
 * only when real on-site times are entered later. Optional on the dataset so the
 * app still works against an older `bands.json` that predates these fields.
 */
export interface Schedule {
  /** Always "PREDICTED" for now. */
  status: string;
  /** Prominent, user-facing "not official" disclaimer. */
  disclaimer: string;
  /** How the prediction was derived (shown for transparency). */
  method: string;
  /** Stage labels in display order. */
  stages: string[];
  /** Day labels in display order, e.g. ["Sat Jul 25", "Sun Jul 26"]. */
  days: string[];
  /** False while these are predictions; true once real times are entered. */
  real_times_available: boolean;
  /**
   * True once the Sat/Sun day split is the OFFICIAL released day-by-day lineup
   * (stage/time within each day stay predicted). Optional — older files lack it.
   */
  days_official?: boolean;
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
  /** PREDICTED schedule metadata (PRD §11). Optional — older files may lack it. */
  schedule?: Schedule;
}

/**
 * Personal status — localStorage only (PRD §4). Display / precedence order is
 * must → maybe → look → skip, where `look` ("Look into") means "need to listen
 * more before deciding." That ordering is the contract: storage's STATUSES
 * array, the My-Picks sections, and the status toggle all render in this order.
 */
export type BandStatus = "must" | "maybe" | "look" | "skip";

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

/**
 * Text comments associated with bands — localStorage key `warped2026:comments`.
 * Keyed by band name. Comments are preserved even if the status is cleared.
 */
export type CommentMap = Record<string, string>;
