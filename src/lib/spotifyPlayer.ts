// SERVER-ONLY Spotify helpers for the personal "play my playlist" endpoint
// (PRD §14). Single user (the app owner), one fixed playlist, playback on the
// owner's phone. Nothing here is imported by client components — it reads
// secrets from process.env and must never reach the browser bundle.
//
// This is deliberately SEPARATE from src/lib/spotify.ts (the disabled,
// client-side playlist-export OAuth, PRD §13). That file is untouched.
//
// Auth model: Authorization Code + PKCE, exactly like the existing export
// integration — it uses the public client id (NEXT_PUBLIC_SPOTIFY_CLIENT_ID)
// and NO client secret. A refresh is `grant_type=refresh_token` + `client_id`
// (Spotify's documented PKCE refresh). The one-time consent is done by
// /api/spotify/owner-auth → /api/spotify/owner-callback; the resulting refresh
// token lives in the SPOTIFY_OWNER_REFRESH_TOKEN env var (no database).

import { createHash, timingSafeEqual } from "node:crypto";

export const OWNER_SCOPES = "user-modify-playback-state user-read-playback-state";

/** Name of the short-lived httpOnly cookie carrying `<state>.<pkce-verifier>`. */
export const OWNER_COOKIE = "spotify_owner_pkce";

const ACCOUNTS_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const ACCOUNTS_TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const TIMEOUT_MS = 8000;

// --- Small shared helpers ---------------------------------------------------

/** The public PKCE client id (shared with the export feature), or "". */
export function getClientId(): string {
  return process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "";
}

/**
 * Constant-time string equality. Both sides are hashed first so the compare is
 * over equal-length buffers (timingSafeEqual throws on a length mismatch, and
 * an early length check would itself leak the secret's length).
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** `Authorization`-free JSON/form fetch against Spotify with a timeout, never cached. */
function spotifyFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// --- Owner auth (PKCE) ------------------------------------------------------

export function buildAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const qs = new URLSearchParams({
    client_id: getClientId(),
    response_type: "code",
    redirect_uri: params.redirectUri,
    scope: OWNER_SCOPES,
    state: params.state,
    code_challenge_method: "S256",
    code_challenge: params.codeChallenge,
    // Always show the consent screen so re-running owner auth reliably yields a
    // fresh refresh token with the right scopes.
    show_dialog: "true",
  });
  return `${ACCOUNTS_AUTHORIZE_URL}?${qs.toString()}`;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken: string | null;
  scope: string;
}

/** Exchange the owner-auth `code` (+ PKCE verifier) for tokens. Throws on failure. */
export async function exchangeCodeForTokens(args: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<ExchangedTokens> {
  const res = await spotifyFetch(ACCOUNTS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: getClientId(),
      code_verifier: args.verifier,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error?: string; error_description?: string };
      detail = err.error_description ?? err.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(`Spotify token exchange failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    scope: json.scope ?? "",
  };
}

/**
 * GET /me/player/devices with a fresh access token — used by the owner-callback
 * page as the live "can this dev-mode app call the player endpoints?" check.
 * Returns the HTTP status and (on success) the visible device names.
 */
export async function probePlayerAccess(
  accessToken: string,
): Promise<{ status: number; devices: string[] }> {
  const res = await spotifyFetch(`${API_BASE}/me/player/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { status: res.status, devices: [] };
  const json = (await res.json()) as { devices?: Array<{ name?: string }> };
  return {
    status: res.status,
    devices: (json.devices ?? []).map((d) => d.name ?? "(unnamed)"),
  };
}

// --- Token refresh ----------------------------------------------------------

/** Spotify rejected the refresh token (revoked/expired/invalid) → re-run owner auth. */
export class RefreshTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshTokenError";
  }
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; rotatedRefreshToken: string | null }> {
  const res = await spotifyFetch(ACCOUNTS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: getClientId(),
    }),
  });
  if (!res.ok) {
    // 400 invalid_grant / 401 invalid_client → the token (or client) is no good.
    if (res.status === 400 || res.status === 401) {
      throw new RefreshTokenError(`Spotify refused the refresh token (HTTP ${res.status})`);
    }
    throw new Error(`Spotify token refresh failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as { access_token: string; refresh_token?: string };
  const rotated =
    json.refresh_token && json.refresh_token !== refreshToken ? json.refresh_token : null;
  return { accessToken: json.access_token, rotatedRefreshToken: rotated };
}

// --- Devices ----------------------------------------------------------------

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
}

/**
 * Pick the playback target: (1) name matches `preferredName` case-insensitively
 * (exact first, then substring so "iPhone" finds "John's iPhone"); (2) first
 * "Smartphone"; (3) the currently active device. Devices with no id or that are
 * restricted (can't be controlled via the API) are never chosen.
 */
export function pickDevice(
  devices: SpotifyDevice[],
  preferredName: string | undefined,
): SpotifyDevice | null {
  const usable = devices.filter((d) => d.id && !d.is_restricted);
  const want = preferredName?.trim().toLowerCase();
  if (want) {
    const exact = usable.find((d) => d.name.toLowerCase() === want);
    if (exact) return exact;
    const partial = usable.find((d) => d.name.toLowerCase().includes(want));
    if (partial) return partial;
  }
  return (
    usable.find((d) => d.type.toLowerCase() === "smartphone") ??
    usable.find((d) => d.is_active) ??
    null
  );
}

// --- Play orchestration -----------------------------------------------------

export interface PlayResult {
  ok: boolean;
  message: string;
  /** HTTP status the route should answer with. */
  status: number;
}

export const MESSAGES = {
  noDevice: "Open Spotify on your iPhone once, then retry",
  premiumOrScope: "Premium/scope issue — re-run owner auth",
  badRefresh: "Refresh token invalid — re-run owner auth",
  notConfigured: "Server isn’t configured — check the Vercel env vars",
  rateLimited: "Spotify is rate limiting — try again in a moment",
  unreachable: "Couldn’t reach Spotify — try again",
} as const;

/** Map a non-OK Spotify player-API status to the Shortcut-facing result. */
export function resultForSpotifyStatus(status: number): PlayResult {
  if (status === 401) return { ok: false, message: MESSAGES.badRefresh, status: 502 };
  if (status === 403) return { ok: false, message: MESSAGES.premiumOrScope, status: 502 };
  if (status === 404) return { ok: false, message: MESSAGES.noDevice, status: 404 };
  if (status === 429) return { ok: false, message: MESSAGES.rateLimited, status: 503 };
  return { ok: false, message: `Spotify error (HTTP ${status})`, status: 502 };
}

export interface PlayConfig {
  refreshToken: string;
  playlistUri: string;
  deviceName?: string;
  shuffle: boolean;
}

/** Read + validate the env. Returns null when anything required is missing. */
export function readPlayConfig(env: NodeJS.ProcessEnv = process.env): PlayConfig | null {
  const refreshToken = env.SPOTIFY_OWNER_REFRESH_TOKEN?.trim();
  const playlistUri = env.SPOTIFY_PLAYLIST_URI?.trim();
  if (!refreshToken || !playlistUri || !getClientId()) return null;
  return {
    refreshToken,
    playlistUri,
    deviceName: env.SPOTIFY_DEVICE_NAME?.trim() || undefined,
    shuffle: env.SPOTIFY_SHUFFLE?.trim().toLowerCase() === "true",
  };
}

/**
 * Accept either a `spotify:playlist:<id>` URI or an open.spotify.com playlist
 * URL (what "Copy link" gives you) and normalize to the URI the API wants.
 */
export function normalizePlaylistUri(input: string): string {
  const m = input.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([A-Za-z0-9]+)/);
  return m ? `spotify:playlist:${m[1]}` : input;
}

async function putPlayer(path: string, accessToken: string, body?: unknown): Promise<Response> {
  return spotifyFetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Start the configured playlist on the owner's phone. Never throws. */
export async function playConfiguredPlaylist(config: PlayConfig): Promise<PlayResult> {
  try {
    let accessToken: string;
    try {
      const t = await refreshAccessToken(config.refreshToken);
      accessToken = t.accessToken;
      if (t.rotatedRefreshToken) {
        // NEVER log the token itself — only that it rotated.
        console.warn(
          "[spotify-play] Spotify issued a rotated refresh token. The current " +
            "SPOTIFY_OWNER_REFRESH_TOKEN still works for now; re-run /api/spotify/owner-auth " +
            "and update the env var before it is revoked.",
        );
      }
    } catch (err) {
      if (err instanceof RefreshTokenError) {
        return { ok: false, message: MESSAGES.badRefresh, status: 502 };
      }
      throw err;
    }

    const devRes = await spotifyFetch(`${API_BASE}/me/player/devices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!devRes.ok) return resultForSpotifyStatus(devRes.status);
    const devJson = (await devRes.json()) as { devices?: SpotifyDevice[] };
    const device = pickDevice(devJson.devices ?? [], config.deviceName);
    if (!device?.id) {
      return { ok: false, message: MESSAGES.noDevice, status: 404 };
    }
    const q = `device_id=${encodeURIComponent(device.id)}`;

    // Shuffle first (per spec). On an inactive device Spotify may 404 this
    // before playback exists — so a non-auth failure is retried after play.
    let shuffleDone = false;
    if (config.shuffle) {
      const sh = await putPlayer(`/me/player/shuffle?state=true&${q}`, accessToken);
      if (sh.status === 401 || sh.status === 403) return resultForSpotifyStatus(sh.status);
      shuffleDone = sh.ok;
    }

    const play = await putPlayer(`/me/player/play?${q}`, accessToken, {
      context_uri: normalizePlaylistUri(config.playlistUri),
    });
    if (!play.ok) return resultForSpotifyStatus(play.status);

    if (config.shuffle && !shuffleDone) {
      // Best-effort: playback is already running, so don't fail the request.
      await putPlayer(`/me/player/shuffle?state=true&${q}`, accessToken).catch(() => undefined);
    }

    return { ok: true, message: `Playing on ${device.name}`, status: 200 };
  } catch (err) {
    // Network/timeout. Log only the error class/message — no tokens in scope here.
    console.error("[spotify-play] request failed:", err instanceof Error ? err.message : err);
    return { ok: false, message: MESSAGES.unreachable, status: 502 };
  }
}
