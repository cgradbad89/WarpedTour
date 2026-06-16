// localStorage read/write for the single personal-state key (PRD §4).
//   key:   "warped2026:status"
//   shape: { [bandName]: "must" | "maybe" | "skip" }   (absence = unset)
// The app NEVER writes bands.json; this is the only user-writable state.

import type { BandStatus, StatusMap } from "@/types";

export const STATUS_KEY = "warped2026:status";

const VALID: ReadonlySet<string> = new Set<BandStatus>(["must", "maybe", "skip"]);

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
