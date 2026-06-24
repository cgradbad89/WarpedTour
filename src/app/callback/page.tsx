"use client";

// Spotify OAuth redirect target (PRD §13). Spotify sends the browser here with
// ?code=…&state=… after the user approves. We exchange the code for tokens
// (PKCE, client-only), then route back to /picks where the export lives. On any
// error we show a friendly message and a link back — the app stays usable.
//
// Reads the query from window.location (not useSearchParams) to avoid a Suspense
// boundary and keep this purely client-side. SSR-safe: all work runs in an effect.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { completeSpotifyAuth, SpotifyAuthError } from "@/lib/spotify";

type Phase = "working" | "error";

export default function SpotifyCallbackPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("working");
  const [message, setMessage] = useState("");
  const [allowlist, setAllowlist] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    // Spotify denied / cancelled. In dev mode "access_denied" most often means
    // the user isn't on the app's allowlist — surface the friendly explanation.
    if (error) {
      setPhase("error");
      if (error === "access_denied") {
        setAllowlist(true);
        setMessage(
          "Spotify didn’t authorize this account. Because the app is in development mode, your Spotify account must be added to its allowlist first.",
        );
      } else {
        setMessage(`Spotify returned an error: ${error}.`);
      }
      return;
    }

    if (!code) {
      setPhase("error");
      setMessage("No authorization code came back from Spotify. Please try connecting again.");
      return;
    }

    let cancelled = false;
    completeSpotifyAuth(code, state)
      .then(() => {
        if (cancelled) return;
        // Replace so the code-bearing URL doesn't linger in history; client-side
        // nav keeps the in-memory token alive into /picks.
        router.replace("/picks?spotify=connected");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPhase("error");
        if (e instanceof SpotifyAuthError) {
          setAllowlist(e.allowlist);
          setMessage(e.message);
        } else {
          setMessage("Something went wrong connecting Spotify. Please try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center px-6 text-center">
      {phase === "working" ? (
        <>
          <div
            className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold">Connecting your Spotify account…</p>
          <p className="mt-1 text-xs text-muted-foreground">One moment.</p>
        </>
      ) : (
        <>
          <h1 className="text-base font-extrabold">Couldn’t connect Spotify</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          {allowlist && (
            <p className="mt-2 text-xs text-muted-foreground">
              Ask the app owner to add your Spotify email to the allowlist, then try again.
            </p>
          )}
          <Link
            href="/picks"
            className="mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-accent px-4 text-sm font-bold text-accent-foreground hover:opacity-90"
          >
            Back to My Picks
          </Link>
        </>
      )}
    </div>
  );
}
