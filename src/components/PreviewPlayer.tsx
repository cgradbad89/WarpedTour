"use client";

import { useEffect, useRef, useState } from "react";
import { resolvePreview } from "@/lib/preview";

// 30-second preview player (PRD §5.2). The preview_url baked into bands.json is a
// short-lived Deezer signed URL that expires within ~a day (PRD §6), so it is NOT
// used as the audio source. On play we resolve a FRESH url from the band's
// deezer_id (via /api/preview), set it on the <audio>, and play — showing a brief
// loading state while resolving and a clean "Preview unavailable" reset on
// failure (never the old flash-and-stop). Bands with no deezer_id (and no stored
// url) show "No preview available."

export function PreviewPlayer({
  deezerId,
  previewUrl,
  topTrack,
  album,
}: {
  deezerId: number | null;
  /** Stored (expected-stale) URL — last-ditch fallback only (PRD §6). */
  previewUrl: string;
  topTrack: string | null;
  album: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedRef = useRef<string | null>(null); // fresh URL once resolved this open
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Pause when the player unmounts. State resets per band automatically because
  // BandDetail keys this component by band (a fresh instance per open), so there's
  // no stale resolvedRef/playing to clear here.
  useEffect(() => {
    const el = audioRef.current;
    return () => el?.pause();
  }, []);

  // Nothing resolvable (the one deezer_id-less band also has no stored url).
  if (deezerId == null && !previewUrl) {
    return (
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        No preview available.
      </p>
    );
  }

  const trackName = topTrack ?? "preview";
  const fail = () => {
    setPlaying(false);
    setLoading(false);
    setFailed(true);
  };

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    setFailed(false);

    // Already resolved this open → just play.
    if (resolvedRef.current) {
      try {
        await el.play();
      } catch {
        fail();
      }
      return;
    }

    // Resolve a fresh URL on demand, then play.
    setLoading(true);
    const url = await resolvePreview(deezerId, previewUrl);
    setLoading(false);
    if (!url) {
      fail();
      return;
    }
    resolvedRef.current = url;
    el.src = url;
    try {
      await el.play();
    } catch {
      fail();
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-busy={loading}
        aria-label={`${playing ? "Pause" : "Play"} ${trackName}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-70"
      >
        {loading ? (
          <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : playing ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-semibold ${
            failed ? "text-muted-foreground" : ""
          }`}
        >
          {failed ? "Preview unavailable" : topTrack ?? "Preview"}
        </span>
        {album && !failed && (
          <span className="block truncate text-xs text-muted-foreground">{album}</span>
        )}
      </span>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => {
          setPlaying(true);
          setFailed(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          // Only a real playback failure of a URL we set (not the empty initial src).
          if (resolvedRef.current) fail();
        }}
      />
    </div>
  );
}
