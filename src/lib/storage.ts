// localStorage read/write for the app's personal-state keys (PRD §4, §10).
// The app NEVER writes bands.json; these are the only user-writable state. When
// the user is signed in (PRD §12) these same shapes are mirrored to Firestore by
// the personal store, but this module stays purely local — it's the logged-out
// path and the offline cache, and it must keep behaving exactly as it does today.
//
//   warped2026:status   { [bandName]: "must" | "maybe" | "look" | "skip" }  (absence = unset)
//   warped2026:order    { [status]: string[] }  ordered band names per My-Picks
//                        section; missing/absent ⇒ fall back to score order
//   warped2026:profile  TasteProfile | absent  (uploaded-taste re-score, §10)
//
// status + order are keyed by exact band name (unique, stable across refreshes).

import type { BandStatus, CommentMap, OrderMap, StatusMap } from "@/types";
import type { TasteProfile, TasteWindowKey } from "./scoring";

export const STATUS_KEY = "warped2026:status";
export const ORDER_KEY = "warped2026:order";
export const COMMENT_KEY = "warped2026:comments";
export const PROFILE_KEY = "warped2026:profile";

// Order matters: this is must → maybe → look → skip (PRD §4). VALID, loadOrder,
// and removeFromOrder all derive from it, so adding "look" here threads the new
// status through validation and order-pruning without touching personal.ts.
const STATUSES: readonly BandStatus[] = ["must", "maybe", "look", "skip"];
const VALID: ReadonlySet<string> = new Set<BandStatus>(STATUSES);

// ---------------------------------------------------------------------------
// Status (warped2026:status)
// ---------------------------------------------------------------------------

/** Read the status map. Returns {} when unset, during SSR, or on parse error. */
export function loadStatus(): StatusMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STATUS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Keep only valid entries — defensive against hand-edited storage.
    const out: StatusMap = {};
    for (const [name, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof val === "string" && VALID.has(val)) out[name] = val as BandStatus;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the whole status map. Non-fatal on quota / private-mode errors. */
export function saveStatus(map: StatusMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATUS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Pure helper: return a new map with `name` set to `status`, or with the key
 * removed when `status` is null (toggling off, per PRD §4). Does not touch
 * storage — callers persist with saveStatus.
 */
export function setBandStatus(
  map: StatusMap,
  name: string,
  status: BandStatus | null,
): StatusMap {
  const next = { ...map };
  if (status === null) delete next[name];
  else next[name] = status;
  return next;
}

/** Wipe all picks — backs the "Clear my picks" affordance (PRD §4). */
export function clearStatus(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STATUS_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Manual order (warped2026:order)
// ---------------------------------------------------------------------------

/** Read the order map. Returns {} when unset, during SSR, or on parse error. */
export function loadOrder(): OrderMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: OrderMap = {};
    for (const status of STATUSES) {
      const arr = (parsed as Record<string, unknown>)[status];
      if (Array.isArray(arr)) {
        out[status] = arr.filter((n): n is string => typeof n === "string");
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the whole order map. Non-fatal on quota / private-mode errors. */
export function saveOrder(map: OrderMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Pure helper: remove a band name from every section's order. Called whenever a
 * band's status changes or is cleared, so stale names don't accumulate (PRD §4).
 */
export function removeFromOrder(map: OrderMap, name: string): OrderMap {
  const out: OrderMap = {};
  for (const status of STATUSES) {
    const arr = map[status];
    if (arr) out[status] = arr.filter((n) => n !== name);
  }
  return out;
}

/** Wipe all saved ordering — paired with clearStatus on "Clear my picks". */
export function clearOrder(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ORDER_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Comments (warped2026:comments)
// ---------------------------------------------------------------------------

/** Read the comments map. Returns {} when unset, during SSR, or on parse error. */
export function loadComments(): CommentMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COMMENT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: CommentMap = {};
    for (const [name, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof val === "string") out[name] = val;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the whole comments map. Non-fatal on quota / private-mode errors. */
export function saveComments(map: CommentMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COMMENT_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Pure helper: return a new map with `name` set to `comment`, or with the key
 * removed when `comment` is empty.
 */
export function setBandComment(
  map: CommentMap,
  name: string,
  comment: string,
): CommentMap {
  const next = { ...map };
  if (!comment.trim()) delete next[name];
  else next[name] = comment;
  return next;
}

/** Wipe all saved comments. */
export function clearComments(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(COMMENT_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Uploaded taste profile (warped2026:profile) — PRD §10
// ---------------------------------------------------------------------------

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Coerce arbitrary parsed JSON into a valid TasteProfile, or null if unusable.
 * Pure (no window access) so the cloud layer and merge logic can reuse it to
 * sanitise a profile read back from Firestore, not just localStorage.
 */
export function normalizeProfile(p: unknown): TasteProfile | null {
  if (!p || typeof p !== "object") return null;
  const obj = p as Record<string, unknown>;
  const w = obj.windows;
  if (!w || typeof w !== "object") return null;
  const wins = w as Record<string, unknown>;

  const win = (k: TasteWindowKey) => {
    const x = (wins[k] ?? {}) as Record<string, unknown>;
    return { artists: asStringArray(x.artists), genres: asStringArray(x.genres) };
  };
  const windows = {
    short_term: win("short_term"),
    medium_term: win("medium_term"),
    long_term: win("long_term"),
  };

  const total = (["short_term", "medium_term", "long_term"] as TasteWindowKey[]).reduce(
    (n, k) => n + windows[k].artists.length + windows[k].genres.length,
    0,
  );
  if (total === 0) return null; // empty profile = no signal → treat as no profile

  const label = typeof obj.label === "string" ? obj.label : undefined;
  return { version: 1, label, windows };
}

/** Read the stored profile. Returns null when unset, during SSR, or on any error. */
export function loadProfile(): TasteProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist a profile. Non-fatal on quota / private-mode errors. */
export function saveProfile(profile: TasteProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

/** Remove the stored profile → the app falls back to the owner's default data. */
export function clearStoredProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}
