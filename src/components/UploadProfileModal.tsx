"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseTasteCsv, TasteCsvError } from "@/lib/tasteCsv";
import type { TasteProfile } from "@/lib/scoring";

// Upload-your-taste dialog (PRD §10). Reads a .csv, parses it client-side into a
// TasteProfile, and hands it to the parent to store + re-score. Defensive: a
// malformed file shows a clear error and never corrupts state. Modelled on
// BandDetail's bottom-sheet/modal for visual consistency.
//
// Flow: pick (or drop) a file → its name shows → press Submit to parse & apply.
// Submit is disabled until a file is chosen; a parse error shows in-modal and the
// dialog stays open (parent only closes on a successful onLoaded).
//
// Rendered via a portal to <body>: the entry point lives inside the page's sticky
// header, whose `backdrop-blur` establishes a containing block for position:fixed.
// Without the portal, `fixed inset-0` would resolve against the header (not the
// viewport) and shove the panel — and its close button — above the screen.

const TEMPLATE_URL =
  "https://docs.google.com/spreadsheets/d/13VVJ-11qkHZEcCN0sQHBQ5j0a1YJzNF3TGxZ3R40NU8/edit?usp=sharing";

export function UploadProfileModal({
  onLoaded,
  onClose,
}: {
  onLoaded: (profile: TasteProfile) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Portal target is client-only — wait for mount before reaching for <body>.
  useEffect(() => setMounted(true), []);

  // Esc to close, lock body scroll while open, focus the close button. Runs once
  // the portal content is committed so closeRef points at a real node.
  useEffect(() => {
    if (!mounted) return;
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
  }, [mounted, onClose]);

  // Stage a chosen/dropped file (no parsing yet — that waits for Submit).
  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    setError(null);
    setFile(f);
  };

  // Parse + apply the staged file. On success the parent persists and closes; on
  // failure we surface the error and keep the modal open.
  const submit = async () => {
    if (!file || busy) return;
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

  if (!mounted) return null;

  return createPortal(
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

      {/* Panel: capped with dvh so it never overflows above the viewport on mobile
          (vh overshoots behind the browser chrome). Header is a pinned, non-scrolling
          flex child; only the body scrolls, so the X is always visible + tappable. */}
      <div className="relative z-10 flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-start gap-3 border-b border-border bg-card px-4 py-3">
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
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
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
              pickFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver
                ? "border-accent bg-accent/5"
                : "border-border hover:border-accent/60 hover:bg-muted"
            }`}
          >
            <span aria-hidden="true" className="text-2xl">♫</span>
            <span className="w-full truncate text-sm font-semibold">
              {file ? file.name : "Choose a .csv file"}
            </span>
            <span className="text-xs text-muted-foreground">
              {file ? "Tap to choose a different file" : "or drag & drop it here"}
            </span>
          </button>

          {/* Primary confirm — parse + apply the chosen file */}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!file || busy}
            className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Reading your file…" : "Upload & re-score"}
          </button>

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-500/30 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div className="space-y-3 border-t border-border pt-4 text-xs text-muted-foreground">
            <div className="space-y-1.5">
              <p>
                <span className="font-semibold text-foreground">No file yet?</span> Start from the{" "}
                <a
                  href={TEMPLATE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-accent underline underline-offset-2 hover:opacity-80"
                >
                  CSV template
                </a>
                . Do <span className="whitespace-nowrap font-medium text-foreground">File → Make a copy</span>{" "}
                first (the shared link is view-only), then fill it in with{" "}
                <a
                  href="https://stats.fm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-accent underline underline-offset-2 hover:opacity-80"
                >
                  stats.fm
                </a>
                :
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Create a stats.fm account and connect it to Spotify.</li>
                <li>
                  Select all the <span className="font-medium text-foreground">Genres</span> shown and
                  paste them into the sheet (the paste format works as-is).
                </li>
                <li>
                  Repeat for <span className="font-medium text-foreground">Top Tracks</span> and{" "}
                  <span className="font-medium text-foreground">Top Artists</span> — switch stats.fm to{" "}
                  <span className="font-medium text-foreground">Grid</span> mode so you get the full
                  list, not just the top few.
                </li>
                <li>
                  Repeat for all three windows:{" "}
                  <span className="font-medium text-foreground">1 month</span>,{" "}
                  <span className="font-medium text-foreground">6 months</span>, and{" "}
                  <span className="font-medium text-foreground">Lifetime</span>.
                </li>
              </ol>
            </div>

            <p>
              <span className="font-semibold text-foreground">Expected format:</span> a 2-row header
              over three windows (Lifetime, 6&nbsp;months, 1&nbsp;month), each with <em>Top Genres</em>,{" "}
              <em>Top artists</em>, and <em>Top tracks</em> columns — exactly what the template gives you.
            </p>
            <p>
              <span className="font-semibold text-foreground">Heads up:</span> re-scored
              “similar artists you listen to” are limited to the similar-artist data already baked into
              each band — some bands have short lists, so a few matches may be missed. Direct artist
              matches are exact.
            </p>
            <p>
              Nothing is uploaded anywhere. Your picks stay yours; loading a profile doesn&apos;t touch
              them.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
