"use client";

// Build a Spotify playlist from the user's picks (PRD §13). Reads picks only —
// never writes bands.json or personal state. For each selected band: find the
// artist on Spotify, take their top 2–3 tracks, then create a private playlist
// and add the (deduped) tracks. Bands with no Spotify match are SKIPPED and
// reported, so one missing artist never fails the whole export.
//
// All calls go straight to api.spotify.com with the session's access token
// (client-only). 429s are honoured via Retry-After with a bounded backoff.

import { getAccessToken, SpotifyAuthError } from "./spotify";
import { normalizeArtist } from "./scoring";
import type { Band, BandStatus } from "@/types";

const API = "https://api.spotify.com/v1";

/** How many top tracks to pull per band (the "2–3 tracks per band" rule). */
export const TRACKS_PER_BAND = 3;
/** Safety cap on total tracks so a huge pick list can't build an absurd playlist. */
const MAX_TOTAL_TRACKS = 300;
/** Spotify caps adding tracks at 100 per request. */
const ADD_CHUNK = 100;

// Exact-ish artist matching reuses scoring.ts's normalizeArtist (NFKD + fold +
// strip non-alnum), so "Panic! At The Disco" ↔ "panicatthedisco" the same way
// the re-score does.

/**
 * Authorised fetch with one layer of 429 (rate-limit) backoff. Refresh of an
 * expired token happens inside getAccessToken(). Throws SpotifyAuthError on 401.
 */
async function api(path: string, init?: RequestInit, attempt = 0): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
    const waitMs = Math.min(Number.isFinite(retryAfter) ? retryAfter : 1, 30) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
    return api(path, init, attempt + 1);
  }
  if (res.status === 401) {
    throw new SpotifyAuthError("Your Spotify session expired — please reconnect.");
  }
  return res;
}

interface SpotifyArtist {
  id: string;
  name: string;
  popularity?: number;
}

interface SpotifyTrack {
  id: string;
  uri: string;
}

/** GET /me — used only for the user id + a market for top-tracks. */
async function getMe(): Promise<{ id: string; country?: string }> {
  const res = await api("/me");
  if (!res.ok) {
    throw new SpotifyAuthError(
      "Couldn’t read your Spotify profile. Please reconnect and try again.",
    );
  }
  return (await res.json()) as { id: string; country?: string };
}

/**
 * Find the best Spotify artist for a band name: prefer a normalized exact match,
 * otherwise the most popular (Spotify already returns by relevance). Null = no
 * match → the caller records it in the "couldn't find" list.
 */
async function findArtist(name: string): Promise<SpotifyArtist | null> {
  const q = encodeURIComponent(name);
  const res = await api(`/search?q=${q}&type=artist&limit=5`);
  if (!res.ok) return null;
  const json = (await res.json()) as { artists?: { items?: SpotifyArtist[] } };
  const items = json.artists?.items ?? [];
  if (items.length === 0) return null;

  const target = normalizeArtist(name);
  const exact = items.filter((a) => normalizeArtist(a.name) === target);
  if (exact.length > 0) {
    return exact.reduce((best, a) =>
      (a.popularity ?? 0) > (best.popularity ?? 0) ? a : best,
    );
  }
  // No exact name match — trust Spotify's relevance ranking (first result).
  return items[0];
}

async function topTracks(artistId: string, market: string): Promise<SpotifyTrack[]> {
  const res = await api(`/artists/${artistId}/top-tracks?market=${market}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { tracks?: SpotifyTrack[] };
  return (json.tracks ?? []).map((t) => ({ id: t.id, uri: t.uri }));
}

async function createPlaylist(
  userId: string,
  name: string,
  description: string,
): Promise<{ id: string; url: string }> {
  const res = await api(`/users/${encodeURIComponent(userId)}/playlists`, {
    method: "POST",
    body: JSON.stringify({ name, public: false, description }),
  });
  if (!res.ok) {
    throw new SpotifyAuthError(
      "Couldn’t create the playlist in your Spotify account. Please try again.",
    );
  }
  const json = (await res.json()) as {
    id: string;
    external_urls?: { spotify?: string };
  };
  return {
    id: json.id,
    url: json.external_urls?.spotify ?? `https://open.spotify.com/playlist/${json.id}`,
  };
}

async function addTracks(playlistId: string, uris: string[]): Promise<void> {
  for (let i = 0; i < uris.length; i += ADD_CHUNK) {
    const chunk = uris.slice(i, i + ADD_CHUNK);
    const res = await api(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: chunk }),
    });
    if (!res.ok) {
      throw new SpotifyAuthError(
        "The playlist was created but some tracks couldn’t be added. Try again.",
      );
    }
  }
}

export interface ExportProgress {
  /** What we're doing now, for the dialog's status line. */
  phase: "searching" | "creating" | "adding";
  /** Bands processed so far (during search). */
  done: number;
  /** Total bands to process. */
  total: number;
}

export interface ExportResult {
  playlistUrl: string;
  playlistName: string;
  trackCount: number;
  /** Bands added to the playlist (at least one track found). */
  addedBands: number;
  /** Band names with no Spotify match — surfaced to the user. */
  notFound: string[];
}

/** The default playlist name — dates match the event (PRD §1). */
export const PLAYLIST_NAME = "Warped Long Beach 2026 — My Picks (Jul 25-26)";

/**
 * Order bands for export: group by status (Must → Maybe → Look into), and within
 * each group by score desc (ties by fans desc) — matches the My-Picks default
 * order. Only the selected statuses are included.
 */
export function bandsForExport(
  bands: Band[],
  status: Record<string, BandStatus>,
  selected: BandStatus[],
): Band[] {
  const byName = new Map(bands.map((b) => [b.name, b]));
  const order: BandStatus[] = ["must", "maybe", "look"];
  const out: Band[] = [];
  for (const s of order) {
    if (!selected.includes(s)) continue;
    const group = Object.keys(status)
      .filter((n) => status[n] === s)
      .map((n) => byName.get(n))
      .filter((b): b is Band => Boolean(b))
      .sort((a, b) => b.score - a.score || b.fans - a.fans);
    out.push(...group);
  }
  return out;
}

/**
 * Run the export. Searches each band, collects top tracks (deduped, capped),
 * creates a private playlist, and adds them. Reports progress and returns a
 * summary incl. the "couldn't find" list. Throws SpotifyAuthError (already
 * user-facing) on auth/playlist failures — the caller shows it and resets.
 */
export async function exportToSpotify(
  bands: Band[],
  onProgress?: (p: ExportProgress) => void,
): Promise<ExportResult> {
  const me = await getMe();
  const market = me.country ?? "US";

  const uris: string[] = [];
  const seen = new Set<string>();
  const notFound: string[] = [];
  let addedBands = 0;

  for (let i = 0; i < bands.length; i++) {
    onProgress?.({ phase: "searching", done: i, total: bands.length });
    if (uris.length >= MAX_TOTAL_TRACKS) break;

    const band = bands[i];
    const artist = await findArtist(band.name);
    if (!artist) {
      notFound.push(band.name);
      continue;
    }
    const tracks = await topTracks(artist.id, market);
    let took = 0;
    for (const t of tracks) {
      if (took >= TRACKS_PER_BAND || uris.length >= MAX_TOTAL_TRACKS) break;
      if (seen.has(t.id)) continue; // dedupe across all bands
      seen.add(t.id);
      uris.push(t.uri);
      took++;
    }
    if (took > 0) addedBands++;
    else if (tracks.length === 0) notFound.push(band.name); // found artist, no tracks
  }
  onProgress?.({ phase: "searching", done: bands.length, total: bands.length });

  onProgress?.({ phase: "creating", done: bands.length, total: bands.length });
  const description =
    "My picks for Vans Warped Tour — Long Beach 2026 (Jul 25–26). Built from the Band Explorer.";
  const playlist = await createPlaylist(me.id, PLAYLIST_NAME, description);

  if (uris.length > 0) {
    onProgress?.({ phase: "adding", done: bands.length, total: bands.length });
    await addTracks(playlist.id, uris);
  }

  return {
    playlistUrl: playlist.url,
    playlistName: PLAYLIST_NAME,
    trackCount: uris.length,
    addedBands,
    notFound,
  };
}
