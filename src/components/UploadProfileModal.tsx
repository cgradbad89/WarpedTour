"use client";

import { useEffect, useRef, useState } from "react";
import { parseTasteCsv, TasteCsvError } from "@/lib/tasteCsv";
import type { TasteProfile } from "@/lib/scoring";

// Upload-your-taste dialog (PRD §10). Reads a .csv, parses it client-side into a
// TasteProfile, and hands it to the parent to store + re-score. Defensive: a
// malformed file shows a clear error and never corrupts state. Modelled on
// BandDetail's bottom-sheet/modal for visual consistency.

export function UploadProfileModal({
  onLoaded,
  onClose,
}: {
  onLoaded: (profile: TasteProfile) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const text = await file.text();
      const profile = parseTasteCsv(text, file.name);
      onLoaded(profile); // parent persists + closes
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof TasteCsvError
          ? e.message
          : "Couldn't read that file. Make sure it's the .csv taste export.",
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upload your Spotify taste"
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto overscroll-contain rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight">Use your own taste</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Re-score every band against your Spotify listening — all in your browser.
            </p>
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

        <div className="space-y-4 px-4 py-4">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />

          {/* Drop zone / picker */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver
                ? "border-accent bg-accent/5"
                : "border-border hover:border-accent/60 hover:bg-muted"
            }`}
          >
            <span aria-hidden="true" className="text-2xl">♫</span>
            <span className="text-sm font-semibold">
              {busy ? "Reading your file…" : "Choose a .csv file"}
            </span>
            <span className="text-xs text-muted-foreground">or drag &amp; drop it here</span>
          </button>

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-500/30 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">Expected format:</span> the
              same CSV the owner used — a 2-row header over three windows (Lifetime,
              6&nbsp;months, 1&nbsp;month), each with <em>Top Genres</em>, <em>Top
              artists</em>, and <em>Top tracks</em> columns.
            </p>
            <p>
              <span className="font-semibold text-foreground">Heads up:</span> re-scored
              “similar artists you listen to” are limited to the similar-artist data
              already baked into each band — some bands have short lists, so a few matches
              may be missed. Direct artist matches are exact.
            </p>
            <p>
              Nothing is uploaded anywhere. Your picks stay yours; loading a profile
              doesn&apos;t touch them.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
