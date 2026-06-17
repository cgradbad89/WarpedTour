// Unit tests for the pure personal-state merge + coercion (src/lib/merge.ts) —
// the login-time merge semantics for optional cloud sync (PRD §12). No Firebase,
// no React, no window — this is plain data, so it runs under node --test directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coerceSnapshot,
  mergeSnapshots,
  snapshotsEqual,
  EMPTY_SNAPSHOT,
  type PersonalSnapshot,
} from "@/lib/merge";
import type { TasteProfile } from "@/lib/scoring";

function profile(label: string): TasteProfile {
  return {
    version: 1,
    label,
    windows: {
      short_term: { artists: ["Some Artist"], genres: [] },
      medium_term: { artists: [], genres: [] },
      long_term: { artists: [], genres: [] },
    },
  };
}

test("coerceSnapshot keeps valid status, order, and profile (punctuated names ok)", () => {
  const snap = coerceSnapshot({
    status: { "Letlive.": "must", "Drop Dead, Gorgeous": "skip" },
    order: { must: ["Letlive."], maybe: [] },
    profile: profile("me"),
  });
  assert.deepEqual(snap.status, { "Letlive.": "must", "Drop Dead, Gorgeous": "skip" });
  // Empty order arrays are dropped; only populated sections survive.
  assert.deepEqual(snap.order, { must: ["Letlive."] });
  assert.equal(snap.profile?.label, "me");
});

test("coerceSnapshot drops invalid values and tolerates garbage", () => {
  assert.deepEqual(coerceSnapshot(null), { status: {}, order: {}, profile: null });
  assert.deepEqual(coerceSnapshot("nope"), { status: {}, order: {}, profile: null });

  const snap = coerceSnapshot({
    status: { Good: "must", Bad: "invalid", Num: 3 },
    order: { must: ["x", 5, null], bogusSection: ["y"] },
    profile: { junk: true },
  });
  assert.deepEqual(snap.status, { Good: "must" }); // invalid status + non-string dropped
  assert.deepEqual(snap.order, { must: ["x"] }); // non-strings + unknown section dropped
  assert.equal(snap.profile, null); // unusable profile → null
});

test("mergeSnapshots unions picks across local and cloud", () => {
  const local: PersonalSnapshot = {
    status: { A: "must", B: "maybe" },
    order: {},
    profile: null,
  };
  const cloud: PersonalSnapshot = { status: { C: "skip" }, order: {}, profile: null };
  assert.deepEqual(mergeSnapshots(local, cloud).status, {
    A: "must",
    B: "maybe",
    C: "skip",
  });
});

test("mergeSnapshots: cloud wins when the same band conflicts", () => {
  const local: PersonalSnapshot = { status: { A: "skip" }, order: {}, profile: null };
  const cloud: PersonalSnapshot = { status: { A: "must" }, order: {}, profile: null };
  assert.equal(mergeSnapshots(local, cloud).status.A, "must");
});

test("mergeSnapshots merges order cloud-first, then local-only extras, deduped", () => {
  const local: PersonalSnapshot = {
    status: {},
    order: { must: ["b", "c", "a"] },
    profile: null,
  };
  const cloud: PersonalSnapshot = { status: {}, order: { must: ["a", "b"] }, profile: null };
  // cloud ["a","b"] first; "c" is the only local name not already seen.
  assert.deepEqual(mergeSnapshots(local, cloud).order.must, ["a", "b", "c"]);
});

test("mergeSnapshots takes the cloud profile if present, else local", () => {
  const local: PersonalSnapshot = { status: {}, order: {}, profile: profile("local") };
  const cloudWith: PersonalSnapshot = { status: {}, order: {}, profile: profile("cloud") };
  const cloudWithout: PersonalSnapshot = { status: {}, order: {}, profile: null };
  assert.equal(mergeSnapshots(local, cloudWith).profile?.label, "cloud");
  assert.equal(mergeSnapshots(local, cloudWithout).profile?.label, "local");
});

test("mergeSnapshots with no cloud doc preserves every local mark (first login)", () => {
  const local: PersonalSnapshot = {
    status: { A: "must" },
    order: { must: ["A"] },
    profile: profile("p"),
  };
  const m = mergeSnapshots(local, EMPTY_SNAPSHOT);
  assert.deepEqual(m.status, { A: "must" });
  assert.deepEqual(m.order.must, ["A"]);
  assert.equal(m.profile?.label, "p");
});

test("mergeSnapshots is idempotent and non-destructive: merge(merged, merged) == merged", () => {
  const local: PersonalSnapshot = {
    status: { A: "must", B: "skip" },
    order: { must: ["A"] },
    profile: profile("x"),
  };
  const cloud: PersonalSnapshot = {
    status: { B: "maybe", C: "look" },
    order: { must: ["C"] },
    profile: profile("y"),
  };
  const merged = mergeSnapshots(local, cloud);
  const again = mergeSnapshots(merged, merged);
  assert.ok(snapshotsEqual(merged, again));
});

test("snapshotsEqual detects equality and difference", () => {
  const a: PersonalSnapshot = { status: { A: "must" }, order: { must: ["A"] }, profile: null };
  const b: PersonalSnapshot = { status: { A: "must" }, order: { must: ["A"] }, profile: null };
  const c: PersonalSnapshot = { status: { A: "maybe" }, order: { must: ["A"] }, profile: null };
  assert.ok(snapshotsEqual(a, b));
  assert.ok(!snapshotsEqual(a, c));
});
