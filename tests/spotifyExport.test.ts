// Unit tests for the pure export-ordering helper (src/lib/spotifyExport.ts) — the
// only non-network, non-React part of the Spotify export (PRD §13). It groups
// picks by status (Must → Maybe → Look into) and sorts each group by score desc
// (ties by fans desc), honouring the chosen statuses. No browser, no Spotify API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandsForExport } from "@/lib/spotifyExport";
import type { Band, BandStatus } from "@/types";

// Minimal Band — only the fields bandsForExport reads (name/score/fans).
function band(name: string, score: number, fans = 0): Band {
  return { name, score, fans } as unknown as Band;
}

const BANDS: Band[] = [
  band("Alpha", 5.0, 100),
  band("Bravo", 4.5, 50),
  band("Charlie", 4.5, 80),
  band("Delta", 3.0, 10),
  band("Echo", 2.0, 5),
];

const STATUS: Record<string, BandStatus> = {
  Alpha: "must",
  Bravo: "must",
  Charlie: "maybe",
  Delta: "look",
  Echo: "skip",
};

test("includes only selected statuses, in must → maybe → look group order", () => {
  const out = bandsForExport(BANDS, STATUS, ["must", "maybe", "look"]).map((b) => b.name);
  // Alpha+Bravo (must), then Charlie (maybe), then Delta (look). Echo (skip) excluded.
  assert.deepEqual(out, ["Alpha", "Bravo", "Charlie", "Delta"]);
});

test("default (Must only) returns just the must picks, score desc", () => {
  const out = bandsForExport(BANDS, STATUS, ["must"]).map((b) => b.name);
  assert.deepEqual(out, ["Alpha", "Bravo"]);
});

test("within a group, ties on score break by fans desc", () => {
  const status: Record<string, BandStatus> = { Bravo: "must", Charlie: "must" };
  const out = bandsForExport(BANDS, status, ["must"]).map((b) => b.name);
  // Both 4.5; Charlie has more fans (80 > 50), so it sorts first.
  assert.deepEqual(out, ["Charlie", "Bravo"]);
});

test("skip is never exportable even if requested-ish; unknown names are dropped", () => {
  const status: Record<string, BandStatus> = { Ghost: "must", Alpha: "must" };
  const out = bandsForExport(BANDS, status, ["must"]).map((b) => b.name);
  // "Ghost" isn't in BANDS → dropped (a refresh can't orphan the export).
  assert.deepEqual(out, ["Alpha"]);
});

test("no selected statuses → empty list", () => {
  assert.deepEqual(bandsForExport(BANDS, STATUS, []), []);
});
