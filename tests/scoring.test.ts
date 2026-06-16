// Unit tests for the client-side re-scoring port (src/lib/scoring.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTaste,
  normalizeArtist,
  rescoreBand,
  rescoreDataset,
  type TasteProfile,
} from "@/lib/scoring";
import type { Band, BandsDataset } from "@/types";

// A small taste profile: JEW + The Used now, Paramore at 6mo, Green Day lifetime.
const PROFILE: TasteProfile = {
  version: 1,
  windows: {
    short_term: { artists: ["Jimmy Eat World", "The Used"], genres: ["emo"] },
    medium_term: { artists: ["Paramore"], genres: ["pop punk"] },
    long_term: { artists: ["Green Day"], genres: ["punk"] },
  },
};
const TASTE = buildTaste(PROFILE);

const OWNER_SUFFIX = " This one's in heavy rotation for you right now — prioritize it.";

/** Build a full Band with sensible defaults so tests only specify what matters. */
function band(p: Partial<Band> & { name: string }): Band {
  return {
    name: p.name,
    score: p.score ?? 1,
    bucket: p.bucket ?? "Discovery",
    match_kind: p.match_kind ?? "none",
    why: p.why ?? "",
    genres: p.genres ?? ["rock"],
    raw_tags: p.raw_tags ?? [],
    bio: p.bio ?? `${p.name} is a rock act from parts unknown.`,
    similar_you_listen: p.similar_you_listen ?? [],
    similar_general: p.similar_general ?? [],
    genre_overlap: p.genre_overlap ?? [],
    top_track: p.top_track ?? null,
    preview_url: p.preview_url ?? "",
    album: p.album ?? "",
    image: p.image ?? "",
    fans: p.fans ?? 0,
    deezer_id: p.deezer_id ?? null,
    spotify_search_uri: p.spotify_search_uri ?? "",
    spotify_web_url: p.spotify_web_url ?? "",
    user_status: null,
  };
}

test("normalizeArtist matches loosely across punctuation/spacing/diacritics", () => {
  assert.equal(normalizeArtist("Panic! At The Disco"), normalizeArtist("panic at the disco"));
  assert.equal(normalizeArtist("blink-182"), normalizeArtist("Blink 182"));
  assert.equal(normalizeArtist("Mötley Crüe"), normalizeArtist("Motley Crue"));
});

test("direct matches snap to the right tier and bucket", () => {
  const now = rescoreBand(band({ name: "Jimmy Eat World" }), TASTE);
  assert.equal(now.score, 5.0);
  assert.equal(now.match_kind, "direct-now");
  assert.equal(now.bucket, "In your rotation");

  const six = rescoreBand(band({ name: "Paramore" }), TASTE);
  assert.equal(six.score, 4.5);
  assert.equal(six.match_kind, "direct-6mo");
  assert.equal(six.bucket, "Must see");

  const life = rescoreBand(band({ name: "Green Day" }), TASTE);
  assert.equal(life.score, 4.5);
  assert.equal(life.match_kind, "direct-life");
});

test("loose name matching still produces a direct hit", () => {
  // profile has "Jimmy Eat World"; a band stored with odd punctuation still hits.
  const b = rescoreBand(band({ name: "jimmy-eat-world!" }), TASTE);
  assert.equal(b.score, 5.0);
  assert.equal(b.match_kind, "direct-now");
});

test("similar tier scales with the count of YOUR artists in the band's related pool", () => {
  const one = rescoreBand(
    band({ name: "Some Band", similar_general: ["The Used", "Nobody"] }),
    TASTE,
  );
  assert.equal(one.match_kind, "similar");
  assert.equal(one.score, 3.5);
  assert.deepEqual(one.similar_you_listen, ["The Used"]);

  const two = rescoreBand(
    band({ name: "Some Band", similar_general: ["The Used", "Paramore", "Nobody"] }),
    TASTE,
  );
  assert.equal(two.score, 4.0);

  const three = rescoreBand(
    band({
      name: "Some Band",
      similar_you_listen: ["Jimmy Eat World"], // reconstruction unions both stored halves
      similar_general: ["The Used", "Green Day", "Nobody"],
    }),
    TASTE,
  );
  assert.equal(three.score, 4.5);
  assert.equal(three.similar_you_listen.length, 3);
});

test("similar_you_listen is recomputed from the upload, never the owner's list", () => {
  // Band carries the OWNER's matches; none are in this profile → must not survive.
  const b = rescoreBand(
    band({
      name: "Knocked Loose",
      similar_you_listen: ["Owner Only Band A", "Owner Only Band B"],
      similar_general: ["The Used"],
    }),
    TASTE,
  );
  assert.deepEqual(b.similar_you_listen, ["The Used"]);
  assert.ok(!b.similar_you_listen.includes("Owner Only Band A"));
  assert.match(b.why, /The Used/);
});

test("genre floor and the 3-overlap nudge", () => {
  const oneGenre = rescoreBand(band({ name: "X", raw_tags: ["emo"] }), TASTE);
  assert.equal(oneGenre.match_kind, "genre");
  assert.equal(oneGenre.score, 1.5);

  const threeGenres = rescoreBand(
    band({ name: "X", raw_tags: ["emo", "pop punk", "punk"] }),
    TASTE,
  );
  assert.equal(threeGenres.match_kind, "genre");
  assert.equal(threeGenres.score, 2.0); // strong overlap nudges 1.5 → 2.0
});

test("scene adjacency and the discovery floor", () => {
  const scene = rescoreBand(band({ name: "X", genres: ["punk"], raw_tags: [] }), TASTE);
  assert.equal(scene.match_kind, "scene");
  assert.equal(scene.score, 2.0);

  const none = rescoreBand(band({ name: "X", genres: ["hip hop"], raw_tags: ["trap"] }), TASTE);
  assert.equal(none.match_kind, "none");
  assert.equal(none.score, 1.0);
});

test("bio: owner's personalised tail is stripped for a friend, re-added only on their direct-now", () => {
  const ownerBio = "Foo is a punk act from United States, active since 1990." + OWNER_SUFFIX;

  // Friend doesn't listen to this band → factual bio only, no owner tail.
  const stripped = rescoreBand(band({ name: "Foo", bio: ownerBio }), TASTE);
  assert.ok(!stripped.bio.includes("heavy rotation"));
  assert.ok(stripped.bio.endsWith("active since 1990."));

  // Band is in the friend's current rotation → the tail is (re)applied.
  const readded = rescoreBand(band({ name: "Jimmy Eat World", bio: ownerBio }), TASTE);
  assert.ok(readded.bio.includes("heavy rotation"));
});

test("rescoreDataset(dataset, null) returns the SAME reference (default view unchanged)", () => {
  const ds = { event: {}, scoring: {}, all_genres: [], buckets: [], bands: [] } as unknown as BandsDataset;
  assert.equal(rescoreDataset(ds, null), ds);
});

// ---- Against the real baked dataset ------------------------------------------

const REAL: BandsDataset = JSON.parse(
  readFileSync(new URL("../public/bands.json", import.meta.url), "utf8"),
);

test("real dataset: no profile leaves every score byte-for-byte identical", () => {
  const out = rescoreDataset(REAL, null);
  assert.equal(out, REAL); // same object, untouched
});

test("real dataset: uploading a profile re-scores without mutating the baked file", () => {
  const before = REAL.bands.map((b) => b.score);
  const knownName = REAL.bands[0].name; // a real lineup band
  const profile: TasteProfile = {
    version: 1,
    windows: {
      short_term: { artists: [knownName], genres: [] },
      medium_term: { artists: [], genres: [] },
      long_term: { artists: [], genres: [] },
    },
  };
  const out = rescoreDataset(REAL, profile);

  // That band is now a current-rotation 5.0…
  const hit = out.bands.find((b) => b.name === knownName);
  assert.ok(hit);
  assert.equal(hit!.score, 5.0);
  assert.equal(hit!.match_kind, "direct-now");

  // …and the input array was not mutated.
  assert.deepEqual(REAL.bands.map((b) => b.score), before);

  // Every re-scored similar_you_listen entry traces back to the uploaded artists.
  const uploaded = new Set([normalizeArtist(knownName)]);
  for (const b of out.bands) {
    for (const a of b.similar_you_listen) {
      assert.ok(uploaded.has(normalizeArtist(a)), `${a} not from upload on ${b.name}`);
    }
  }
});
