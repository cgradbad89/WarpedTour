"use client";

// Uploaded-taste-profile state (PRD §10). A friend uploads their Spotify taste
// CSV; we parse it (src/lib/tasteCsv.ts), store the parsed per-window profile in
// localStorage under `warped2026:profile`, and re-score the baked bands.json
// against it live (src/lib/scoring.ts). No backend, no API calls.
//
//   warped2026:profile  TasteProfile | absent
//
// This key is SEPARATE from the picks/order keys (warped2026:status / :order),
// which stay the friend's own per-browser state — loading or clearing a profile
// never touches them, so a re-score never wipes anyone's picks (PRD §10, §4).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BandsDataset } from "@/types";
import { rescoreDataset, type TasteProfile, type TasteWindowKey } from "./scoring";
import { useBands } from "./bands";

export const PROFILE_KEY = "warped2026:profile";

// ---------------------------------------------------------------------------
// Storage (defensive — survives hand-edited / stale / partial data)
// ---------------------------------------------------------------------------

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Coerce arbitrary parsed JSON into a valid TasteProfile, or null if unusable. */
function normalizeProfile(p: unknown): TasteProfile | null {
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

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface ProfileState {
  /** The active uploaded profile, or null for the owner's default view. */
  profile: TasteProfile | null;
  /** True once localStorage has been read (client-only) — avoids load flicker logic. */
  ready: boolean;
  setProfile: (profile: TasteProfile) => void;
  clearProfile: () => void;
}

/** Owns the profile in memory and keeps it in sync with localStorage (client-only). */
export function useProfile(): ProfileState {
  const [profile, setProfileState] = useState<TasteProfile | null>(null);
  const [ready, setReady] = useState(false);

  // Client-only load: localStorage is undefined during SSR, so we must start at
  // `null` on both the server and the first client render (otherwise ProfileBar
  // would hydrate "your upload" against a server-rendered "default" and mismatch)
  // and adopt the stored profile in this effect. This is the same deliberate
  // pattern as usePersonalState; the set-state-in-effect rule is a false positive
  // for SSR-only state, so it's disabled here with intent.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-only state; see note above
    setProfileState(loadProfile());
    setReady(true);
  }, []);

  const setProfile = useCallback((next: TasteProfile) => {
    saveProfile(next);
    setProfileState(next);
  }, []);

  const clearProfile = useCallback(() => {
    clearStoredProfile();
    setProfileState(null);
  }, []);

  return { profile, ready, setProfile, clearProfile };
}

export interface ExplorerData {
  /** Effective dataset: re-scored when a profile is active, else the baked file. */
  data: BandsDataset | null;
  loading: boolean;
  error: string | null;
  profile: TasteProfile | null;
  profileReady: boolean;
  setProfile: (profile: TasteProfile) => void;
  clearProfile: () => void;
}

/**
 * The data seam shared by "/" and "/picks": fetch the baked dataset, read the
 * uploaded profile, and expose the EFFECTIVE dataset. With no profile, `data` is
 * the baked dataset unchanged (same reference) so the owner's default view is
 * byte-for-byte identical (PRD §10). With a profile, every band is re-scored.
 */
export function useExplorerData(): ExplorerData {
  const { data: raw, loading, error } = useBands();
  const { profile, ready, setProfile, clearProfile } = useProfile();

  const data = useMemo(
    () => (raw && profile ? rescoreDataset(raw, profile) : raw),
    [raw, profile],
  );

  return { data, loading, error, profile, profileReady: ready, setProfile, clearProfile };
}
