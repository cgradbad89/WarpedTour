// GET /api/spotify/owner-auth?key=<PLAY_SECRET>
//
// One-time owner consent for the personal "play my playlist" endpoint (PRD §14).
// Gated by PLAY_SECRET (so strangers can't start a consent flow against your
// client id), then redirects to Spotify with the PKCE challenge + a random
// `state`. state + verifier ride in a short-lived httpOnly cookie that
// /api/spotify/owner-callback checks. Separate from the disabled export OAuth.

import { randomBytes } from "node:crypto";
import {
  OWNER_COOKIE,
  buildAuthorizeUrl,
  getClientId,
  pkceChallenge,
  secretsMatch,
} from "@/lib/spotifyPlayer";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const expected = process.env.PLAY_SECRET ?? "";

  // Fail closed: an unset PLAY_SECRET rejects everyone.
  if (!secretsMatch(url.searchParams.get("key"), expected)) {
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!getClientId()) {
    return new Response("NEXT_PUBLIC_SPOTIFY_CLIENT_ID is not set.", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url"); // 64 chars, within PKCE's 43–128
  const redirectUri = `${url.origin}/api/spotify/owner-callback`;

  const authorize = buildAuthorizeUrl({
    redirectUri,
    state,
    codeChallenge: pkceChallenge(verifier),
  });

  const secure = url.protocol === "https:";
  const cookie = [
    `${OWNER_COOKIE}=${state}.${verifier}`,
    "Path=/api/spotify",
    "HttpOnly",
    "SameSite=Lax", // the return from accounts.spotify.com is a top-level GET
    "Max-Age=600",
    ...(secure ? ["Secure"] : []),
  ].join("; ");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize,
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer", // don't leak ?key= to Spotify
    },
  });
}
