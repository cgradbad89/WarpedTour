"use client";

// Loads and types the canonical data layer, public/bands.json (PRD §3).
// The app fetches it once at runtime; bands.json is read-only (CLAUDE.md).

import { useEffect, useState } from "react";
import type { BandsDataset } from "@/types";

/** Fetch + minimally validate /bands.json. Throws on network or shape error. */
export async function loadBands(signal?: AbortSignal): Promise<BandsDataset> {
  const res = await fetch("/bands.json", { signal });
  if (!res.ok) {
    throw new Error(`Could not load bands.json (HTTP ${res.status})`);
  }
  const data = (await res.json()) as BandsDataset;
  if (!data || !Array.isArray(data.bands) || !Array.isArray(data.buckets)) {
    throw new Error("bands.json is malformed");
  }
  return data;
}

export interface BandsState {
  data: BandsDataset | null;
  loading: boolean;
  error: string | null;
}

/** Fetch bands.json once on mount, exposing loading / error / data state. */
export function useBands(): BandsState {
  const [state, setState] = useState<BandsState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const ctrl = new AbortController();
    loadBands(ctrl.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return; // unmounted / superseded
        const message =
          err instanceof Error ? err.message : "Failed to load band data.";
        setState({ data: null, loading: false, error: message });
      });
    return () => ctrl.abort();
  }, []);

  return state;
}
