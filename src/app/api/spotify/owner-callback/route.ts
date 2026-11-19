// GET /api/spotify/owner-callback?code=…&state=…
//
// Finishes the one-time owner consent (PRD §14): verifies `state` against the
// httpOnly cookie, exchanges the code (PKCE, no secret), then renders a plain
// page showing the refresh token ONCE so you can paste it into Vercel as
// SPOTIFY_OWNER_REFRESH_TOKEN. Nothing is stored or logged — no database.
//
// It also makes a live GET /me/player/devices call with the fresh access token
// and reports the result, which doubles as the "can this dev-mode app use the
// player endpoints?" check.

import { OWNER_COOKIE, exchangeCodeForTokens, probePlayerAccess } from "@/lib/spotifyPlayer";

export const dynamic = "force-dynamic";

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  // The page shows a secret: forbid framing, scripts and any subresources.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "X-Robots-Tag": "noindex",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title: string, bodyHtml: string, status = 200, clearCookie = true): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem}
code,textarea{font:13px ui-monospace,monospace}textarea{width:100%;height:7rem}
.ok{color:#0a7d33}.bad{color:#b00020}</style></head><body>${bodyHtml}</body></html>`;
  const headers = new Headers(PAGE_HEADERS);
  if (clearCookie) {
    headers.append(
      "Set-Cookie",
      `${OWNER_COOKIE}=; Path=/api/spotify; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }
  return new Response(html, { status, headers });
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    return page("Spotify owner auth", `<h1 class="bad">Spotify declined</h1><p>${esc(error)}</p>`, 400);
  }

  const cookie = readCookie(request, OWNER_COOKIE);
  const dot = cookie ? cookie.indexOf(".") : -1;
  const expectedState = cookie && dot > 0 ? cookie.slice(0, dot) : "";
  const verifier = cookie && dot > 0 ? cookie.slice(dot + 1) : "";

  // Plain compare is fine here: `state` is a one-time CSRF token, not a secret
  // an attacker can iterate against (the cookie is cleared on every response).
  if (!code || !state || !expectedState || !verifier || state !== expectedState) {
    return page(
      "Spotify owner auth",
      `<h1 class="bad">Invalid or expired login</h1>
<p>Start again from <code>/api/spotify/owner-auth?key=…</code> (the handshake cookie lasts 10 minutes).</p>`,
      400,
    );
  }

  try {
    const redirectUri = `${url.origin}/api/spotify/owner-callback`;
    const tokens = await exchangeCodeForTokens({ code, verifier, redirectUri });
    if (!tokens.refreshToken) {
      return page(
        "Spotify owner auth",
        `<h1 class="bad">No refresh token returned</h1><p>Spotify didn’t issue one. Try again.</p>`,
        502,
      );
    }

    // Live player-endpoint check (the dev-mode gate).
    let probe = "";
    try {
      const p = await probePlayerAccess(tokens.accessToken);
      probe =
        p.status === 200
          ? `<p class="ok"><strong>Player API check: OK.</strong> GET /me/player/devices → 200
(${p.devices.length ? "devices: " + esc(p.devices.join(", ")) : "no devices visible right now — open Spotify on your iPhone"}).</p>`
          : `<p class="bad"><strong>Player API check FAILED:</strong> GET /me/player/devices → HTTP ${p.status}.
${p.status === 403 ? "A 403 here usually means a Premium or dev-mode restriction." : ""}
Do not rely on this setup until that is resolved.</p>`;
    } catch {
      probe = `<p class="bad">Player API check couldn’t reach Spotify.</p>`;
    }

    return page(
      "Spotify owner refresh token",
      `<h1>Spotify owner refresh token</h1>
<p>Shown <strong>once</strong>. Copy it now into Vercel as <code>SPOTIFY_OWNER_REFRESH_TOKEN</code>
(Production), then redeploy. It is not stored or logged anywhere.</p>
<textarea readonly>${esc(tokens.refreshToken)}</textarea>
<p>Granted scopes: <code>${esc(tokens.scope)}</code></p>
${probe}
<p>Reloading this page won’t work — the one-time code is spent. To get a new token, re-run owner auth.</p>`,
    );
  } catch (err) {
    // The message comes from our own exchange helper (HTTP status + Spotify's
    // error code) — it never contains the code, verifier, or any token.
    console.error("[spotify-owner-callback]", err instanceof Error ? err.message : "failed");
    return page(
      "Spotify owner auth",
      `<h1 class="bad">Token exchange failed</h1><p>${esc(
        err instanceof Error ? err.message : "Unknown error",
      )}</p><p>Check that the redirect URI <code>${esc(url.origin)}/api/spotify/owner-callback</code>
is registered in the Spotify dashboard exactly.</p>`,
      502,
    );
  }
}
