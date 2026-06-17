"use client";

// Uploaded-taste-profile hooks (PRD §10) + the re-score seam (useExplorerData).
// The profile's storage now lives in the shared PersonalStore
// (src/lib/personalStore.tsx), so it persists to localStorage when logged out
// (exactly as today) or syncs to Firestore when logged in (PRD §12) — this module
// just exposes it. The profile key is SEPARATE from picks/order: loading or
// clearing it never touches them, so a re-score never wipes anyone's picks.
//
// The actual localStorage read/write/normalise helpers moved to src/lib/storage.ts
// (so the cloud/merge layers can reuse them without a hook dependency); they're
// re-exported here for any callers that still import them from "@/lib/profile".

import { useMemo } from "react";
import type { BandsDataset } from "@/types";
import { rescoreDataset, type TasteProfile } from "./scoring";
import { useBands } from "./bands";
import { usePersonalStore } from "./personalStore";

export {
  PROFILE_KEY,
  loadProfile,
  saveProfile,
  clearStoredProfile,
  normalizeProfile,
} from "./storage";

export interface ProfileState {
  /** The active uploaded profile, or null for the owner's default view. */
  profile: TasteProfile | null;
  /** True once localStorage has been read (client-only) — avoids load flicker logic. */
  ready: boolean;
  setProfile: (profile: TasteProfile) => void;
  clearProfile: () => void;
}

/** The active profile + its setters, sourced from the shared personal store. */
export function useProfile(): ProfileState {
  const { profile, profileReady, setProfile, clearProfile } = usePersonalStore();
  return { profile, ready: profileReady, setProfile, clearProfile };
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
 * The data seam shared by "/", "/picks", and "/schedule": fetch the baked dataset,
 * read the uploaded profile, and expose the EFFECTIVE dataset. With no profile,
 * `data` is the baked dataset unchanged (same reference) so the owner's default
 * view is byte-for-byte identical (PRD §10). With a profile, every band is
 * re-scored. The schedule's pred_* fields survive re-score (PRD §11.4).
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
