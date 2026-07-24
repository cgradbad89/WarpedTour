"use client";

// Shared personal-state hook used by "/", "/picks", and "/schedule" — picks
// (status) + My-Picks ordering (order). It is now a thin reader over the shared
// PersonalStore (src/lib/personalStore.tsx), which owns the state and decides
// whether it lives in localStorage (logged out — exactly as today) or syncs to
// Firestore (logged in — PRD §12). The contract returned here is unchanged, so
// the pages don't care which storage backs it.

import type { BandStatus, CommentMap, OrderMap, StatusMap } from "@/types";
import { usePersonalStore } from "./personalStore";

export interface PersonalState {
  status: StatusMap;
  order: OrderMap;
  comments: CommentMap;
  /** Set or clear (null) a band's status; also prunes it from any saved order. */
  changeStatus: (name: string, next: BandStatus | null) => void;
  /** Persist an explicit ordered name list for one status section. */
  setSectionOrder: (status: BandStatus, names: string[]) => void;
  /** Drop a section's manual order → it falls back to score order. */
  resetSectionOrder: (status: BandStatus) => void;
  /** Clear ALL picks and ordering (the "Clear my picks" affordance). */
  clearAll: () => void;
  /** Number of bands with any status set. */
  pickCount: number;
  /** Set or clear a comment for a band. Empty string clears it. */
  setComment: (name: string, comment: string) => void;
}

export function usePersonalState(): PersonalState {
  const {
    status,
    order,
    comments,
    changeStatus,
    setSectionOrder,
    resetSectionOrder,
    clearAll,
    pickCount,
    setComment,
  } = usePersonalStore();
  return {
    status,
    order,
    comments,
    changeStatus,
    setSectionOrder,
    resetSectionOrder,
    clearAll,
    pickCount,
    setComment,
  };
}
