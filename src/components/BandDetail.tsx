"use client";

import { useEffect, useRef } from "react";
import type { Band, BandStatus } from "@/types";
import { Avatar } from "./Avatar";
import { Stars } from "./Stars";
import { PreviewPlayer } from "./PreviewPlayer";
import { StatusToggle } from "./StatusToggle";

// Band detail as a bottom sheet on mobile / centered modal on larger screens
// (PRD §5.2 — chosen over a /band route to dodge slug/punctuation issues).

export function BandDetail({
  band,
  status,
  rescored = false,
  onStatusChange,
  onClose,
}: {
  band: Band;
  status: BandStatus | undefined;
  /** True when the score/why/similar lists were re-scored from an uploaded profile. */
  rescored?: boolean;
  onStatusChange: (status: BandStatus | null) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Esc to close, lock body scroll while open, focus the close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Try the Spotify app via the spotify: URI. If nothing handles it the page
  // simply stays put — which is why the web link below is always visible (PRD §6).
  const openInSpotify = () => {
    window.location.href = band.spotify_search_uri;
  };

  const hasSimilar =
    band.similar_you_listen.length > 0 || band.similar_general.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={band.name}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto overscroll-contain rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        {/* sticky header */}
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
          <Avatar name={band.name} image={band.image} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold leading-tight">{band.name}</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              {band.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {g}
                </span>
              ))}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 px-4 py-4">
          {/* score block */}
          <div className="flex items-center gap-3">
            <span className="text-3xl font-extrabold tabular-nums">
              {band.score.toFixed(1)}
            </span>
            <div>
              <Stars score={band.score} size={18} />
              <div className="text-xs font-semibold text-muted-foreground">
                {band.bucket}
              </div>
            </div>
          </div>

          <p className="text-sm font-medium">{band.why}</p>
          {band.bio && <p className="text-sm text-muted-foreground">{band.bio}</p>}

          <PreviewPlayer
            key={band.name}
            deezerId={band.deezer_id}
            previewUrl={band.preview_url}
            topTrack={band.top_track}
            album={band.album}
          />

          {/* Open in Spotify — primary (app) + always-visible web fallback */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={openInSpotify}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#1DB954] px-4 font-semibold text-black"
            >
              Open in Spotify
            </button>
            <a
              href={band.spotify_web_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs text-muted-foreground underline underline-offset-2"
            >
              or open in your browser
            </a>
          </div>

          {/* similar artists, side by side */}
          {hasSimilar && (
            <div>
              <div className="grid grid-cols-2 gap-4">
              {band.similar_you_listen.length > 0 && (
                <div className="min-w-0">
                  <h3 className="mb-1 text-xs font-bold text-accent">
                    Similar artists you listen to
                  </h3>
                  <ul className="space-y-0.5 text-sm font-medium">
                    {band.similar_you_listen.map((a) => (
                      <li key={a} className="truncate">
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {band.similar_general.length > 0 && (
                <div className="min-w-0">
                  <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                    Similar artists generally
                  </h3>
                  <ul className="space-y-0.5 text-sm text-muted-foreground">
                    {band.similar_general.map((a) => (
                      <li key={a} className="truncate">
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              </div>
              {rescored && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Re-scored from your upload — “similar artists you listen to” is
                  limited to the similar-artist data baked into each band.
                </p>
              )}
            </div>
          )}

          {/* status toggle */}
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              My plan
            </h3>
            <StatusToggle value={status} onChange={onStatusChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
