// Unit tests for the taste-CSV parser (src/lib/tasteCsv.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTasteCsv, TasteCsvError } from "@/lib/tasteCsv";

// A valid export: 2-row header over 9 columns. The 1-month group is SHUFFLED
// (artists column BEFORE genres) to prove category detection is by-label, not by
// position. Includes rank prefixes and an embedded sub-header row to strip.
const VALID = [
  "Lifetime,,,6 months,,,1 month,,",
  "Top Genres,Top artists,Top tracks,Top Genres,Top artists,Top tracks,Top artists,Top Genres,Top tracks",
  "Your top genres of all time,,,,,,,,", // embedded sub-header → skipped
  "1. punk,1. Green Day,1. Basket Case,1. pop punk,1. A Day to Remember,1. All I Want,1. Jimmy Eat World,1. emo,1. The Middle",
  "2. rock,2. AFI,2. Holiday,2. emo,2. New Found Glory,2. Hit or Miss,2. The Used,2. pop punk,2. Box Car Racer",
].join("\n");

test("parses windows by detected label, even when a group is shuffled", () => {
  const p = parseTasteCsv(VALID, "taste.csv");
  assert.equal(p.version, 1);
  assert.equal(p.label, "taste.csv");

  assert.deepEqual(p.windows.long_term.artists, ["Green Day", "AFI"]);
  assert.deepEqual(p.windows.long_term.genres, ["punk", "rock"]);

  assert.deepEqual(p.windows.medium_term.artists, ["A Day to Remember", "New Found Glory"]);
  assert.deepEqual(p.windows.medium_term.genres, ["pop punk", "emo"]);

  // 1-month group had artists in col 6 and genres in col 7 (opposite order).
  assert.deepEqual(p.windows.short_term.artists, ["Jimmy Eat World", "The Used"]);
  assert.deepEqual(p.windows.short_term.genres, ["emo", "pop punk"]);
});

test("strips rank prefixes and embedded sub-header rows", () => {
  const p = parseTasteCsv(VALID);
  // No "1. " prefixes survive, and the "Your top genres…" row contributed nothing.
  for (const w of ["short_term", "medium_term", "long_term"] as const) {
    for (const name of [...p.windows[w].artists, ...p.windows[w].genres]) {
      assert.ok(!/^\d+\./.test(name), `rank prefix leaked: ${name}`);
      assert.ok(!/your top/i.test(name), `sub-header leaked: ${name}`);
    }
  }
});

test("positional fallback when window labels are absent (Lifetime → 6mo → 1mo order)", () => {
  const noWindowRow = [
    "Top Genres,Top artists,Top tracks,Top Genres,Top artists,Top tracks,Top Genres,Top artists,Top tracks",
    "1. punk,1. Green Day,1. x,1. pop punk,1. Paramore,1. y,1. emo,1. Jimmy Eat World,1. z",
  ].join("\n");
  const p = parseTasteCsv(noWindowRow);
  assert.deepEqual(p.windows.long_term.artists, ["Green Day"]);
  assert.deepEqual(p.windows.medium_term.artists, ["Paramore"]);
  assert.deepEqual(p.windows.short_term.artists, ["Jimmy Eat World"]);
});

test("throws a clear error when no header row is present", () => {
  assert.throws(
    () => parseTasteCsv("foo,bar,baz\n1,2,3"),
    (e: unknown) => e instanceof TasteCsvError && /header/i.test((e as Error).message),
  );
});

test("throws when the header has no artists under it", () => {
  const headerOnly = [
    "Lifetime,,,6 months,,,1 month,,",
    "Top Genres,Top artists,Top tracks,Top Genres,Top artists,Top tracks,Top Genres,Top artists,Top tracks",
  ].join("\n");
  assert.throws(() => parseTasteCsv(headerOnly), TasteCsvError);
});

test("throws on an empty file", () => {
  assert.throws(() => parseTasteCsv("   \n  \n"), TasteCsvError);
});

test("handles quoted artist names containing commas", () => {
  const csv = [
    "Lifetime,,,6 months,,,1 month,,",
    "Top Genres,Top artists,Top tracks,Top Genres,Top artists,Top tracks,Top Genres,Top artists,Top tracks",
    '1. punk,"1. Tyler, the Creator",1. x,1. emo,1. Paramore,1. y,1. pop punk,1. blink-182,1. z',
  ].join("\n");
  const p = parseTasteCsv(csv);
  assert.deepEqual(p.windows.long_term.artists, ["Tyler, the Creator"]);
  assert.deepEqual(p.windows.short_term.artists, ["blink-182"]);
});
