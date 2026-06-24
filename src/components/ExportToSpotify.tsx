"use client";

// "Export to Spotify" on the My Picks page (PRD §13). Reads picks (status) and
// builds a private playlist in the user's OWN Spotify account: 2–3 top tracks
// per selected band. Bands with no Spotify match are skipped and listed.
//
// Gating:
//   - No client id configured  → renders NOTHING (feature off; app unchanged).
//   - Configured, not connected → button opens a "Connect Spotify" prompt.
//   - Connected                → status-selection dialog → export → result.
//
// Connecting Spotify is SEPARATE from the Firebase Google sign-in (PRD §12).
// Dialog portals to <body> for the same reason UploadProfileModal does (a
// backdrop-blur ancestor would otherwise capture position:fixed).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSpotify } from "@/lib/spotifyConnection";
import { SpotifyAuthError } from "@/lib/spotify";
import {
  bandsForExport,
  exportToSpotify,
  TRACKS_PER_BAND,
  type ExportProgress,
  type ExportResult,
} from "@/lib/spotifyExport";
import type { Band, BandStatus } from "@/types";

const STATUS_OPTIONS: { value: BandStatus; label: string }[] = [
  { value: "must", label: "Must see" },
  { value: "maybe", label: "Maybe" },
  { value: "look", label: "Look into" },
];

type Stage = "idle" | "exporting" | "done" | "error";

export function ExportToSpotify({
  bands,
  status,
}: {
  bands: Band[];
  status: Record<string, BandStatus>;
}) {
  const { configured, connected, ready, connect, disconnect } = useSpotify();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  // Default: Must checked; the user can add Maybe / Look into.
  const [selected, setSelected] = useState<Record<BandStatus, boolean>>({
    must: true,
    maybe: false,
    look: false,
    skip: false,
  });
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<{ message: string; allowlist: boolean } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
    // Returning from the Spotify OAuth round-trip (/callback → here): open the
    // dialog straight to the status-selection step, and tidy the URL.
    if (window.location.search.includes("spotify=connected")) {
      setOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("spotify");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  // Per-status pick counts (display-only; correct before bands.json loads too).
  const counts = useMemo(() => {
    const c: Record<BandStatus, number> = { must: 0, maybe: 0, look: 0, skip: 0 };
    for (const s of Object.values(status)) c[s] += 1;
    return c;
  }, [status]);

  const selectedStatuses = STATUS_OPTIONS.map((o) => o.value).filter((s) => selected[s]);
  const bandCount = selectedStatuses.reduce((n, s) => n + counts[s], 0);

  // Esc + body-scroll lock while the dialog is open (mirrors UploadProfileModal).
  useEffect(() => {
    if (!open || !mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stage !== "exporting") closeDialog();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, stage]);

  // Feature off entirely when unconfigured — keep the page identical to today.
  if (!mounted || !ready || !configured) return null;

  const closeDialog = () => {
    if (stage === "exporting") return; // never abandon a run mid-flight
    setOpen(false);
    // Reset transient result/error so reopening starts clean.
    setStage("idle");
    setResult(null);
    setError(null);
    setProgress(null);
  };

  const onConnect = async () => {
    setConnecting(true);
    await connect(); // redirects away (or no-ops if unconfigured)
  };

  const runExport = async () => {
    const list = bandsForExport(bands, status, selectedStatuses);
    if (list.length === 0) return;
    setStage("exporting");
    setError(null);
    setProgress({ phase: "searching", done: 0, total: list.length });
    try {
      const res = await exportToSpotify(list, setProgress);
      setResult(res);
      setStage("done");
    } catch (e) {
      const isAuth = e instanceof SpotifyAuthError;
      setError({
        message: isAuth
          ? e.message
          : "Something went wrong building the playlist. Please try again.",
        allowlist: isAuth ? e.allowlist : false,
      });
      setStage("error");
      // An expired/invalid session disconnects inside spotify.ts; reflect it.
    }
  };

  return (
    <>
      {/* Trigger — lives in the My Picks header area. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-4 text-sm font-bold text-black transition-opacity hover:opacity-90"
      >
        <SpotifyGlyph />
        Export to Spotify
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Export to Spotify"
          >
            <div
              aria-hidden="true"
              onClick={closeDialog}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <div className="relative z-10 flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
              <div className="flex shrink-0 items-start gap-3 border-b border-border bg-card px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-2 text-lg font-bold leading-tight">
                    <SpotifyGlyph className="text-[#1DB954]" />
                    Export to Spotify
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Build a private playlist of your picks in your own account.
                  </p>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={closeDialog}
                  disabled={stage === "exporting"}
                  aria-label="Close"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
                {!connected ? (
                  <ConnectPrompt connecting={connecting} onConnect={onConnect} />
                ) : stage === "done" && result ? (
                  <ResultView result={result} onClose={closeDialog} />
                ) : stage === "exporting" ? (
                  <ProgressView progress={progress} />
                ) : (
                  <SelectView
                    counts={counts}
                    selected={selected}
                    onToggle={(s) => setSelected((v) => ({ ...v, [s]: !v[s] }))}
                    bandCount={bandCount}
                    onExport={runExport}
                    onDisconnect={() => {
                      disconnect();
                    }}
                    error={error}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function ConnectPrompt({
  connecting,
  onConnect,
}: {
  connecting: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect your Spotify account to create the playlist. This is separate from
        signing in to sync your picks — it only lets the app add a playlist to your
        Spotify.
      </p>
      <button
        type="button"
        onClick={onConnect}
        disabled={connecting}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-4 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <SpotifyGlyph />
        {connecting ? "Redirecting to Spotify…" : "Connect Spotify"}
      </button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The app is in Spotify development mode, so your Spotify account must be on
        its allowlist. If connecting fails with “not authorized,” ask the owner to
        add your Spotify email.
      </p>
    </div>
  );
}

function SelectView({
  counts,
  selected,
  onToggle,
  bandCount,
  onExport,
  onDisconnect,
  error,
}: {
  counts: Record<BandStatus, number>;
  selected: Record<BandStatus, boolean>;
  onToggle: (s: BandStatus) => void;
  bandCount: number;
  onExport: () => void;
  onDisconnect: () => void;
  error: { message: string; allowlist: boolean } | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">Which picks to include?</p>
        <div className="mt-2 space-y-2">
          {STATUS_OPTIONS.map((o) => (
            <label
              key={o.value}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-3 ring-1 ring-inset ring-border hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected[o.value]}
                onChange={() => onToggle(o.value)}
                className="h-5 w-5 accent-[#1DB954]"
              />
              <span className="flex-1 text-sm font-semibold">{o.label}</span>
              <span className="text-xs font-bold tabular-nums text-muted-foreground">
                {counts[o.value]}
              </span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Up to {TRACKS_PER_BAND} top tracks per band. Bands not found on Spotify are
        skipped and listed afterward.
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-500/30 dark:text-red-300"
        >
          <p>{error.message}</p>
          {error.allowlist && (
            <p className="mt-1 text-xs">
              Ask the app owner to add your Spotify email to the allowlist.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onExport}
        disabled={bandCount === 0}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-4 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {bandCount === 0
          ? "No bands selected"
          : `Export ${bandCount} band${bandCount === 1 ? "" : "s"} → playlist`}
      </button>

      <button
        type="button"
        onClick={onDisconnect}
        className="w-full text-center text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Disconnect Spotify
      </button>
    </div>
  );
}

function ProgressView({ progress }: { progress: ExportProgress | null }) {
  const label =
    progress?.phase === "creating"
      ? "Creating your playlist…"
      : progress?.phase === "adding"
        ? "Adding tracks…"
        : `Finding artists on Spotify… ${progress?.done ?? 0}/${progress?.total ?? 0}`;
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-[#1DB954]"
        aria-hidden="true"
      />
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-muted-foreground">
        Keep this open — building the playlist can take a moment.
      </p>
    </div>
  );
}

function ResultView({
  result,
  onClose,
}: {
  result: ExportResult;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#1DB954]/10 px-4 py-3 ring-1 ring-inset ring-[#1DB954]/30">
        <p className="text-sm font-bold">Playlist created 🎉</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Added <span className="font-semibold text-foreground">{result.trackCount}</span>{" "}
          track{result.trackCount === 1 ? "" : "s"} from{" "}
          <span className="font-semibold text-foreground">{result.addedBands}</span>{" "}
          band{result.addedBands === 1 ? "" : "s"}.
        </p>
      </div>

      <a
        href={result.playlistUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-4 text-sm font-bold text-black transition-opacity hover:opacity-90"
      >
        <SpotifyGlyph />
        Open “{result.playlistName}”
      </a>

      {result.notFound.length > 0 && (
        <div className="rounded-xl bg-muted px-3 py-2">
          <p className="text-xs font-semibold">
            Couldn’t find on Spotify ({result.notFound.length}):
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.notFound.join(", ")}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="min-h-[44px] w-full rounded-xl px-4 text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted"
      >
        Done
      </button>
    </div>
  );
}

function SpotifyGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.586 14.424a.624.624 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 11-.277-1.216c3.809-.87 7.077-.496 9.712 1.116a.624.624 0 01.207.857zm1.223-2.722a.78.78 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 11-.452-1.493c3.632-1.102 8.147-.568 11.233 1.329a.78.78 0 01.256 1.073zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.935.935 0 11-.542-1.79c3.533-1.072 9.404-.865 13.115 1.338a.936.936 0 01-.956 1.609z" />
    </svg>
  );
}
