"use client";

// Spotify connection — Authorization Code + PKCE (PRD §13). This is a SECOND,
// SEPARATE OAuth from the optional Firebase Google sign-in (§12): being signed
// into the app and connecting Spotify are independent. It exists only to let the
// user export their picks into a playlist in their OWN Spotify account.
//
// PKCE = no client secret in the browser (public client). The only env var is
// the PUBLIC client id (NEXT_PUBLIC_SPOTIFY_CLIENT_ID); when it's missing the
// whole feature is disabled gracefully (the Export button is hidden) and the
// rest of the app is untouched.
//
// Hard guarantees (mirrors firebase.ts / auth.tsx discipline):
//   - SSR-safe: every browser API (crypto, sessionStorage, window, fetch to
//     accounts.spotify.com) is reached only from functions that run client-side.
//   - Tokens live IN MEMORY ONLY (module-scope) for the session — nothing
//     sensitive is written to localStorage. The PKCE code-verifier is the only
//     thing persisted, transiently, in sessionStorage across the auth redirect.
//   - Allowlist-only dev mode: we never attempt production approval. A blocked
//     (not-allowlisted) user is surfaced with a friendly message by the caller.

// Only what a private playlist needs. `playlist-modify-public` is intentionally
// NOT requested — we always create PRIVATE playlists.
const SCOPE = "playlist-modify-private";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// Transient PKCE material — sessionStorage so it survives the full-page redirect
// to Spotify and back (same tab/origin), then is deleted on token exchange.
const PKCE_VERIFIER_KEY = "warped2026:spotify_pkce_verifier";
const PKCE_STATE_KEY = "warped2026:spotify_pkce_state";

/** Thrown for any Spotify auth problem the UI should surface verbatim. */
export class SpotifyAuthError extends Error {
  /** True when the cause is most likely "not on the app's allowlist" (dev mode). */
  readonly allowlist: boolean;
  constructor(message: string, allowlist = false) {
    super(message);
    this.name = "SpotifyAuthError";
    this.allowlist = allowlist;
  }
}

interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

// In-memory token store + a tiny pub/sub so React state can mirror it across
// routes (the /callback page sets tokens, the /picks page reads "connected").
let tokens: TokenSet | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Subscribe to connection changes. Returns an unsubscribe fn. */
export function subscribeSpotify(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The PUBLIC client id, or "" when unset (feature then stays disabled). */
export function getSpotifyClientId(): string {
  return process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "";
}

/** True when a client id is configured — gates whether the feature shows at all. */
export function isSpotifyConfigured(): boolean {
  return getSpotifyClientId().length > 0;
}

/** True when we currently hold Spotify tokens for this session. */
export function isSpotifyConnected(): boolean {
  return tokens !== null;
}

/** Forget the session's tokens (a "Disconnect" affordance). Never throws. */
export function disconnectSpotify(): void {
  tokens = null;
  emit();
}

// --- PKCE primitives (client-only; crypto.subtle requires a secure context) ---

function randomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (const n of arr) out += chars[n % chars.length];
  return out;
}

function base64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

/** The redirect URI — the app's own /callback, derived so it works in dev + prod. */
function redirectUri(): string {
  return `${window.location.origin}/callback`;
}

/**
 * Begin the PKCE flow: mint a verifier/challenge + state, stash the verifier in
 * sessionStorage, and redirect the browser to Spotify's consent screen. Returns
 * (after navigating away) only if the feature is unconfigured / not in a browser.
 */
export async function beginSpotifyAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  const clientId = getSpotifyClientId();
  if (!clientId) return;

  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(16);
  try {
    window.sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    window.sessionStorage.setItem(PKCE_STATE_KEY, state);
  } catch {
    // Private mode / disabled storage — the exchange will fail clearly later.
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPE,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  window.location.href = `${AUTHORIZE_URL}?${params.toString()}`;
}

function storeTokens(json: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}): void {
  tokens = {
    accessToken: json.access_token,
    // A refresh keeps the previously-issued refresh token if Spotify omits one.
    refreshToken: json.refresh_token ?? tokens?.refreshToken ?? null,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  emit();
}

/**
 * Finish the flow on the /callback route: validate state, exchange the code for
 * tokens (PKCE, no secret), and store them in memory. Throws SpotifyAuthError
 * with a user-facing message on any failure. The caller clears the URL + routes
 * onward.
 */
export async function completeSpotifyAuth(
  code: string,
  state: string | null,
): Promise<void> {
  const clientId = getSpotifyClientId();
  if (!clientId) throw new SpotifyAuthError("Spotify isn’t configured.");

  let verifier: string | null = null;
  let expectedState: string | null = null;
  try {
    verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY);
    expectedState = window.sessionStorage.getItem(PKCE_STATE_KEY);
  } catch {
    /* storage unavailable */
  }
  if (!verifier) {
    throw new SpotifyAuthError(
      "Lost the secure login handshake. Please try connecting again.",
    );
  }
  if (expectedState && state && state !== expectedState) {
    throw new SpotifyAuthError(
      "Login response didn’t match this device. Please try connecting again.",
    );
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new SpotifyAuthError(
      "Couldn’t reach Spotify to finish connecting. Check your connection and try again.",
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error?: string; error_description?: string };
      detail = err.error_description ?? err.error ?? "";
    } catch {
      /* ignore */
    }
    throw new SpotifyAuthError(
      detail
        ? `Spotify rejected the connection: ${detail}`
        : "Spotify rejected the connection. Please try again.",
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  storeTokens(json);

  try {
    window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    window.sessionStorage.removeItem(PKCE_STATE_KEY);
  } catch {
    /* ignore */
  }
}

async function refreshAccessToken(): Promise<void> {
  const clientId = getSpotifyClientId();
  if (!tokens?.refreshToken || !clientId) {
    disconnectSpotify();
    throw new SpotifyAuthError("Your Spotify session expired — please reconnect.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    disconnectSpotify();
    throw new SpotifyAuthError("Your Spotify session expired — please reconnect.");
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  storeTokens(json);
}

/**
 * Return a valid access token, refreshing first if it's within 30s of expiry.
 * Throws SpotifyAuthError when not connected or the refresh fails.
 */
export async function getAccessToken(): Promise<string> {
  if (!tokens) throw new SpotifyAuthError("Not connected to Spotify.");
  if (Date.now() >= tokens.expiresAt - 30_000) {
    await refreshAccessToken();
  }
  // tokens is non-null here (storeTokens ran or we returned the existing token).
  return tokens!.accessToken;
}
