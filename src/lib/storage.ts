// localStorage read/write for the app's personal-state keys (PRD §4).
// The app NEVER writes bands.json; these are the only user-writable state.
//
//   warped2026:status  { [bandName]: "must" | "maybe" | "skip" }   (absence = unset)
//   warped2026:order   { [status]: string[] }  ordered band names per My-Picks
//                       section; missing/absent ⇒ fall back to score order
//
// Both are keyed by exact band name (unique, stable across bands.json refreshes).

import type { BandStatus, OrderMap, StatusMap } from "@/types";

export const STATUS_KEY = "warped2026:status";
export const ORDER_KEY = "warped2026:order";

const STATUSES: readonly BandStatus[] = ["must", "maybe", "skip"];
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
