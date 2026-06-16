// Resolve a FRESH 30-second preview URL at play time (PRD §5.2, §6).
//
// bands.json's stored preview_url is a time-limited Deezer signed link that
// expires within ~a day, so we never play it directly. On play we ask our own
// /api/preview route (Deezer blocks direct browser fetch via CORS) for a freshly
// signed URL, keyed by the band's deezer_id. Results are memoised in memory for
// the session so re-playing the same band doesn't re-fetch.

const cache = new Map<number, string>();

/**
 * Resolve a playable preview URL for a band.
 * - Returns a fresh, signed Deezer URL when resolution succeeds (and memoises it).
 * - Falls back to the stored `fallbackUrl` (likely expired) only if resolution
 *   fails, per PRD §6 — a last-ditch attempt, not cached.
 * - Returns null when there's nothing playable (no deezer_id and no fallback).
 */
export async function resolvePreview(
  deezerId: number | null,
  fallbackUrl?: string,
): Promise<string | null> {
  if (deezerId == null) return fallbackUrl || null;

  const memo = cache.get(deezerId);
  if (memo) return memo;

  try {
    const res = await fetch(`/api/preview?id=${encodeURIComponent(String(deezerId))}`);
    if (res.ok) {
      const data = (await res.json()) as { preview?: string | null };
      if (data?.preview) {
        cache.set(deezerId, data.preview);
        return data.preview;
      }
    }
  } catch {
    /* network error → fall through to the stored fallback */
  }
  return fallbackUrl || null;
}
