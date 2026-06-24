"use client";

// React seam over the in-memory Spotify token store (src/lib/spotify.ts).
// Mirrors the auth.tsx pattern: a provider that exposes connection state and
// connect/disconnect, degrading to an inert "not configured" state when the
// NEXT_PUBLIC_SPOTIFY_CLIENT_ID env is missing. This is SEPARATE from the
// Firebase Google auth (PRD §12) — connecting Spotify never touches sign-in.
//
// SSR-safety: `configured`/`connected` resolve in an effect (start at their
// inert values), so the server and first client render agree (no hydration
// mismatch). Components that show Spotify UI additionally guard on `mounted`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  beginSpotifyAuth,
  disconnectSpotify,
  isSpotifyConfigured,
  isSpotifyConnected,
  subscribeSpotify,
} from "./spotify";

export interface SpotifyConnectionState {
  /** True when a client id is configured — gates whether the feature shows. */
  configured: boolean;
  /** True once we hold tokens for this session. */
  connected: boolean;
  /** True once this provider has mounted on the client (SSR guard). */
  ready: boolean;
  /** Kick off the PKCE redirect to Spotify. No-op when unconfigured. */
  connect: () => Promise<void>;
  /** Forget the session's tokens. */
  disconnect: () => void;
}

const INERT: SpotifyConnectionState = {
  configured: false,
  connected: false,
  ready: false,
  connect: async () => {},
  disconnect: () => {},
};

const SpotifyContext = createContext<SpotifyConnectionState | null>(null);

export function SpotifyProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    setConfigured(isSpotifyConfigured());
    setConnected(isSpotifyConnected());
    setReady(true);
    // Re-render whenever the token store changes (set on /callback, cleared on
    // disconnect / expiry) — including across client-side route changes.
    return subscribeSpotify(() => setConnected(isSpotifyConnected()));
  }, []);

  const connect = useCallback(async () => {
    await beginSpotifyAuth();
  }, []);

  const disconnect = useCallback(() => {
    disconnectSpotify();
  }, []);

  const value = useMemo<SpotifyConnectionState>(
    () => ({ configured, connected, ready, connect, disconnect }),
    [configured, connected, ready, connect, disconnect],
  );

  return <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>;
}

/** Read Spotify connection state. Safe inert default if used outside the provider. */
export function useSpotify(): SpotifyConnectionState {
  return useContext(SpotifyContext) ?? INERT;
}
