// POST /api/play
//
// Personal one-tap endpoint for an Apple Watch Shortcut (PRD §14): starts the
// owner's fixed playlist on their phone's Spotify app. Auth is a shared secret
// in the `x-play-secret` header (constant-time compare). All Spotify calls live
// in src/lib/spotifyPlayer.ts. Response is short JSON a Shortcut can display:
//   {"ok":true,"message":"Playing on <device>"} | {"ok":false,"message":"…"}

import {
  MESSAGES,
  playConfiguredPlaylist,
  readPlayConfig,
  secretsMatch,
} from "@/lib/spotifyPlayer";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  // Fail closed: if PLAY_SECRET is unset, nothing matches.
  if (!secretsMatch(request.headers.get("x-play-secret"), process.env.PLAY_SECRET ?? "")) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const config = readPlayConfig();
  if (!config) {
    return Response.json(
      { ok: false, message: MESSAGES.notConfigured },
      { status: 500, headers: NO_STORE },
    );
  }

  const result = await playConfiguredPlaylist(config);
  return Response.json(
    { ok: result.ok, message: result.message },
    { status: result.status, headers: NO_STORE },
  );
}
