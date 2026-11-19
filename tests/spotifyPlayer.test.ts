// Unit tests for the personal "play my playlist" helpers (src/lib/spotifyPlayer.ts,
// PRD §14): device selection, constant-time secret compare, PKCE challenge,
// playlist-URI normalization, env parsing, and the play orchestration against a
// mocked global fetch (no network, no real Spotify).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGES,
  normalizePlaylistUri,
  pickDevice,
  pkceChallenge,
  playConfiguredPlaylist,
  readPlayConfig,
  resultForSpotifyStatus,
  secretsMatch,
  type SpotifyDevice,
} from "@/lib/spotifyPlayer";

function dev(over: Partial<SpotifyDevice> & { name: string }): SpotifyDevice {
  return { id: `id-${over.name}`, type: "Computer", is_active: false, is_restricted: false, ...over };
}

test("secretsMatch: equal, unequal, empty, differing length", () => {
  assert.equal(secretsMatch("abc123", "abc123"), true);
  assert.equal(secretsMatch("abc123", "abc124"), false);
  assert.equal(secretsMatch("abc", "abc123"), false);
  assert.equal(secretsMatch("", "abc123"), false);
  assert.equal(secretsMatch(null, "abc123"), false);
  assert.equal(secretsMatch("abc123", ""), false, "unset secret must fail closed");
});

test("pkceChallenge matches the RFC 7636 appendix B vector", () => {
  assert.equal(
    pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("pickDevice: name (case-insensitive) beats Smartphone beats active", () => {
  const list = [
    dev({ name: "Kitchen", type: "Speaker", is_active: true }),
    dev({ name: "Some Phone", type: "Smartphone" }),
    dev({ name: "John's iPhone", type: "Smartphone" }),
  ];
  assert.equal(pickDevice(list, "john's IPHONE")?.name, "John's iPhone"); // exact, any case
  assert.equal(pickDevice(list, "iphone")?.name, "John's iPhone"); // substring
  assert.equal(pickDevice(list, "nonexistent")?.name, "Some Phone"); // Smartphone fallback
  assert.equal(pickDevice(list, undefined)?.name, "Some Phone");
  assert.equal(
    pickDevice([dev({ name: "Kitchen", type: "Speaker", is_active: true })], "iPhone")?.name,
    "Kitchen",
    "falls back to the active device",
  );
  assert.equal(pickDevice([dev({ name: "Kitchen", type: "Speaker" })], "iPhone"), null);
  assert.equal(pickDevice([], "iPhone"), null);
});

test("pickDevice skips restricted devices and ones without an id", () => {
  const list = [
    dev({ name: "iPhone", type: "Smartphone", is_restricted: true }),
    dev({ name: "iPhone 2", type: "Smartphone", id: null }),
  ];
  assert.equal(pickDevice(list, "iPhone"), null);
});

test("normalizePlaylistUri accepts URIs and open.spotify.com links", () => {
  assert.equal(normalizePlaylistUri("spotify:playlist:37i9dQZF1DX"), "spotify:playlist:37i9dQZF1DX");
  assert.equal(
    normalizePlaylistUri("https://open.spotify.com/playlist/37i9dQZF1DX?si=abc"),
    "spotify:playlist:37i9dQZF1DX",
  );
  assert.equal(
    normalizePlaylistUri("https://open.spotify.com/intl-de/playlist/37i9dQZF1DX"),
    "spotify:playlist:37i9dQZF1DX",
  );
});

test("resultForSpotifyStatus maps statuses to the documented messages", () => {
  assert.equal(resultForSpotifyStatus(401).message, MESSAGES.badRefresh);
  assert.equal(resultForSpotifyStatus(403).message, MESSAGES.premiumOrScope);
  assert.equal(resultForSpotifyStatus(404).message, MESSAGES.noDevice);
  assert.equal(resultForSpotifyStatus(429).status, 503);
  assert.match(resultForSpotifyStatus(500).message, /500/);
});

test("readPlayConfig requires token + playlist + client id; parses shuffle", () => {
  const prev = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
  process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID = "cid";
  try {
    assert.equal(readPlayConfig({} as NodeJS.ProcessEnv), null);
    assert.equal(readPlayConfig({ SPOTIFY_OWNER_REFRESH_TOKEN: "r" } as unknown as NodeJS.ProcessEnv), null);
    const cfg = readPlayConfig({
      SPOTIFY_OWNER_REFRESH_TOKEN: "r",
      SPOTIFY_PLAYLIST_URI: "spotify:playlist:x",
      SPOTIFY_DEVICE_NAME: " iPhone ",
      SPOTIFY_SHUFFLE: "TRUE",
    } as unknown as NodeJS.ProcessEnv);
    assert.deepEqual(cfg, {
      refreshToken: "r",
      playlistUri: "spotify:playlist:x",
      deviceName: "iPhone",
      shuffle: true,
    });
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
    else process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID = prev;
  }
});

// --- playConfiguredPlaylist against a scripted fetch -------------------------

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call { url: string; method: string; body?: string }

/** Install a fetch that answers by "METHOD path-prefix" and records calls. */
function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? String(init.body) : undefined });
    for (const [key, make] of Object.entries(routes)) {
      const [m, prefix] = key.split(" ");
      if (m === method && url.includes(prefix)) return make();
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const CFG = {
  refreshToken: "refresh-1",
  playlistUri: "spotify:playlist:abc",
  deviceName: "iPhone",
  shuffle: true,
};

test("play: happy path refreshes, finds device, shuffles first, then plays the context", async () => {
  const calls = mockFetch({
    "POST /api/token": () => json({ access_token: "at", expires_in: 3600 }),
    "GET /me/player/devices": () =>
      json({ devices: [dev({ name: "John's iPhone", type: "Smartphone", id: "dev1" })] }),
    "PUT /me/player/shuffle": () => new Response(null, { status: 204 }),
    "PUT /me/player/play": () => new Response(null, { status: 204 }),
  });
  const r = await playConfiguredPlaylist(CFG);
  assert.deepEqual({ ok: r.ok, message: r.message, status: r.status }, {
    ok: true,
    message: "Playing on John's iPhone",
    status: 200,
  });
  const order = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
  assert.deepEqual(order, [
    "POST /api/token",
    "GET /v1/me/player/devices",
    "PUT /v1/me/player/shuffle",
    "PUT /v1/me/player/play",
  ]);
  const play = calls[3];
  assert.match(play.url, /device_id=dev1/);
  assert.deepEqual(JSON.parse(play.body!), { context_uri: "spotify:playlist:abc" });
});

test("play: no matching device → friendly message, 404, no play call", async () => {
  const calls = mockFetch({
    "POST /api/token": () => json({ access_token: "at" }),
    "GET /me/player/devices": () => json({ devices: [] }),
  });
  const r = await playConfiguredPlaylist(CFG);
  assert.equal(r.ok, false);
  assert.equal(r.message, MESSAGES.noDevice);
  assert.equal(r.status, 404);
  assert.equal(calls.some((c) => c.method === "PUT"), false);
});

test("play: refresh token rejected → re-run owner auth message", async () => {
  mockFetch({ "POST /api/token": () => json({ error: "invalid_grant" }, 400) });
  const r = await playConfiguredPlaylist(CFG);
  assert.equal(r.message, MESSAGES.badRefresh);
});

test("play: 403 from play → Premium/scope message", async () => {
  mockFetch({
    "POST /api/token": () => json({ access_token: "at" }),
    "GET /me/player/devices": () => json({ devices: [dev({ name: "iPhone", type: "Smartphone" })] }),
    "PUT /me/player/shuffle": () => new Response(null, { status: 204 }),
    "PUT /me/player/play": () => json({ error: { status: 403 } }, 403),
  });
  const r = await playConfiguredPlaylist(CFG);
  assert.equal(r.message, MESSAGES.premiumOrScope);
});

test("play: rotated refresh token warns without logging the token, and still succeeds", async () => {
  mockFetch({
    "POST /api/token": () => json({ access_token: "at", refresh_token: "ROTATED-SECRET" }),
    "GET /me/player/devices": () => json({ devices: [dev({ name: "iPhone", type: "Smartphone" })] }),
    "PUT /me/player/play": () => new Response(null, { status: 204 }),
  });
  const logged: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    const r = await playConfiguredPlaylist({ ...CFG, shuffle: false });
    assert.equal(r.ok, true);
  } finally {
    console.warn = origWarn;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /SPOTIFY_OWNER_REFRESH_TOKEN/);
  assert.equal(logged[0].includes("ROTATED-SECRET"), false);
});

test("play: shuffle 404 before playback is retried after play, not fatal", async () => {
  let shuffleCalls = 0;
  mockFetch({
    "POST /api/token": () => json({ access_token: "at" }),
    "GET /me/player/devices": () => json({ devices: [dev({ name: "iPhone", type: "Smartphone" })] }),
    "PUT /me/player/shuffle": () => {
      shuffleCalls++;
      return shuffleCalls === 1 ? json({}, 404) : new Response(null, { status: 204 });
    },
    "PUT /me/player/play": () => new Response(null, { status: 204 }),
  });
  const r = await playConfiguredPlaylist(CFG);
  assert.equal(r.ok, true);
  assert.equal(shuffleCalls, 2);
});
