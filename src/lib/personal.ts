"use client";

// Shared personal-state hook used by both "/" and "/picks". Owns the in-memory
// status + order maps, keeps them in sync with localStorage, and exposes the
// mutations. Each page mounts its own instance and loads fresh on mount, so
// navigating between routes always reflects the latest stored state (PRD §4).

import { useCallback, useEffect, useState } from "react";
import type { BandStatus, OrderMap, StatusMap } from "@/types";
import {
  clearOrder,
  clearStatus,
  loadOrder,
  loadStatus,
  removeFromOrder,
  saveOrder,
  saveStatus,
  setBandStatus,
} from "./storage";

export interface PersonalState {
  status: StatusMap;
  order: OrderMap;
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
}

export function usePersonalState(): PersonalState {
  const [status, setStatus] = useState<StatusMap>({});
  const [order, setOrder] = useState<OrderMap>({});

  // Client-only load (localStorage is undefined during SSR — avoids hydration mismatch).
  useEffect(() => {
    setStatus(loadStatus());
    setOrder(loadOrder());
  }, []);

  const changeStatus = useCallback((name: string, next: BandStatus | null) => {
    setStatus((prev) => {
      const updated = setBandStatus(prev, name, next);
      saveStatus(updated);
      return updated;
    });
    // Any status change makes the old section's saved position stale → drop it.
    setOrder((prev) => {
      const updated = removeFromOrder(prev, name);
      saveOrder(updated);
      return updated;
    });
  }, []);

  const setSectionOrder = useCallback((s: BandStatus, names: string[]) => {
    setOrder((prev) => {
      const updated = { ...prev, [s]: names };
      saveOrder(updated);
      return updated;
    });
  }, []);

  const resetSectionOrder = useCallback((s: BandStatus) => {
    setOrder((prev) => {
      const updated = { ...prev };
      delete updated[s];
      saveOrder(updated);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    clearStatus();
    clearOrder();
    setStatus({});
    setOrder({});
  }, []);

  return {
    status,
    order,
    changeStatus,
    setSectionOrder,
    resetSectionOrder,
    clearAll,
    pickCount: Object.keys(status).length,
  };
}
