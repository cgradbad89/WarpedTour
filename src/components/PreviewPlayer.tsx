"use client";

import { useEffect, useRef, useState } from "react";

// 30-second preview player (PRD §5.2). Custom play/pause button over a native
// <audio>. When preview_url is empty (1 band has none), render a clear
// "No preview available." instead of a dead control.

export function PreviewPlayer({
  previewUrl,
  topTrack,
  album,
}: {
  previewUrl: string;
  topTrack: string | null;
  album: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Pause if the preview source changes or the player unmounts (modal closes).
  useEffect(() => {
    const el = audioRef.current;
    return () => el?.pause();
  }, [previewUrl]);

  if (!previewUrl) {
    return (
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        No preview available.
      </p>
    );
  }

  const label = topTrack ?? "Preview";
  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground"
      >
        {playing ? (
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
        <span className="block truncate text-sm font-semibold">{label}</span>
        {album && (
          <span className="block truncate text-xs text-muted-foreground">{album}</span>
        )}
      </span>
      <audio
        ref={audioRef}
        src={previewUrl}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
