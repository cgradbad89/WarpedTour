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
import { COMMENT_KEY, coerceCommentMap, loadComments } from "@/lib/storage";

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

test("coerceSnapshot keeps valid status, order, comments, and profile (punctuated names ok)", () => {
  const snap = coerceSnapshot({
    status: { "Letlive.": "must", "Drop Dead, Gorgeous": "skip" },
    order: { must: ["Letlive."], maybe: [] },
    comments: { "Letlive.": "Catch the full set", "Drop Dead, Gorgeous": "Listen first" },
    profile: profile("me"),
  });
  assert.deepEqual(snap.status, { "Letlive.": "must", "Drop Dead, Gorgeous": "skip" });
  // Empty order arrays are dropped; only populated sections survive.
  assert.deepEqual(snap.order, { must: ["Letlive."] });
  assert.deepEqual(snap.comments, {
    "Letlive.": "Catch the full set",
    "Drop Dead, Gorgeous": "Listen first",
  });
  assert.equal(snap.profile?.label, "me");
});

test("coerceSnapshot treats legacy snapshots without comments as an empty comments map", () => {
  const legacy = coerceSnapshot({
    status: { A: "must" },
    order: { must: ["A"] },
    profile: profile("legacy"),
  });
  assert.deepEqual(legacy, {
    status: { A: "must" },
    order: { must: ["A"] },
    comments: {},
    profile: profile("legacy"),
  });
});

test("coerceSnapshot drops invalid values and tolerates garbage", () => {
  const empty = { status: {}, order: {}, comments: {}, profile: null };
  assert.deepEqual(coerceSnapshot(null), empty);
  assert.deepEqual(coerceSnapshot("nope"), empty);
  assert.deepEqual(coerceSnapshot({ comments: "not a map" }), empty);
  assert.deepEqual(coerceSnapshot({ comments: ["not a band-keyed record"] }), empty);

  const snap = coerceSnapshot({
    status: { Good: "must", Bad: "invalid", Num: 3 },
    order: { must: ["x", 5, null], bogusSection: ["y"] },
    comments: { Good: "keep this", Number: 3, Null: null, Object: { text: "no" } },
    profile: { junk: true },
  });
  assert.deepEqual(snap.status, { Good: "must" }); // invalid status + non-string dropped
  assert.deepEqual(snap.order, { must: ["x"] }); // non-strings + unknown section dropped
  assert.deepEqual(snap.comments, { Good: "keep this" });
  assert.equal(snap.profile, null); // unusable profile → null
});

test("local-storage comment coercion rejects arrays and filters plain-record values", () => {
  assert.deepEqual(coerceCommentMap(["not a band-keyed record"]), {});
  assert.deepEqual(
    coerceCommentMap({ Good: "keep this", Number: 3, Null: null, Nested: { text: "no" } }),
    { Good: "keep this" },
  );

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let stored = JSON.stringify(["not a band-keyed record"]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => (key === COMMENT_KEY ? stored : null),
      },
    },
  });
  try {
    assert.deepEqual(loadComments(), {});
    stored = JSON.stringify({ Good: "keep this", Number: 3 });
    assert.deepEqual(loadComments(), { Good: "keep this" });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("mergeSnapshots unions picks and independent local/cloud comments without loss", () => {
  const local: PersonalSnapshot = {
    status: { A: "must", B: "maybe" },
    order: {},
    comments: { A: "local only" },
    profile: null,
  };
  const cloud: PersonalSnapshot = {
    status: { C: "skip" },
    order: {},
    comments: { C: "cloud only" },
    profile: null,
  };
  const merged = mergeSnapshots(local, cloud);
  assert.deepEqual(merged.status, {
    A: "must",
    B: "maybe",
    C: "skip",
  });
  assert.deepEqual(merged.comments, { A: "local only", C: "cloud only" });
});

test("mergeSnapshots: cloud wins same-band status and comment conflicts", () => {
  const local: PersonalSnapshot = {
    status: { A: "skip" },
    order: {},
    comments: { A: "local" },
    profile: null,
  };
  const cloud: PersonalSnapshot = {
    status: { A: "must" },
    order: {},
    comments: { A: "cloud" },
    profile: null,
  };
  const merged = mergeSnapshots(local, cloud);
  assert.equal(merged.status.A, "must");
  assert.equal(merged.comments.A, "cloud");
});

test("mergeSnapshots merges order cloud-first, then local-only extras, deduped", () => {
  const local: PersonalSnapshot = {
    status: {},
    order: { must: ["b", "c", "a"] },
    comments: {},
    profile: null,
  };
  const cloud: PersonalSnapshot = {
    status: {},
    order: { must: ["a", "b"] },
    comments: {},
    profile: null,
  };
  // cloud ["a","b"] first; "c" is the only local name not already seen.
  assert.deepEqual(mergeSnapshots(local, cloud).order.must, ["a", "b", "c"]);
});

test("mergeSnapshots takes the cloud profile if present, else local", () => {
  const local: PersonalSnapshot = {
    status: {},
    order: {},
    comments: {},
    profile: profile("local"),
  };
  const cloudWith: PersonalSnapshot = {
    status: {},
    order: {},
    comments: {},
    profile: profile("cloud"),
  };
  const cloudWithout: PersonalSnapshot = { status: {}, order: {}, comments: {}, profile: null };
  assert.equal(mergeSnapshots(local, cloudWith).profile?.label, "cloud");
  assert.equal(mergeSnapshots(local, cloudWithout).profile?.label, "local");
});

test("mergeSnapshots with no cloud doc preserves every local mark (first login)", () => {
  const local: PersonalSnapshot = {
    status: { A: "must" },
    order: { must: ["A"] },
    comments: { A: "keep across first login" },
    profile: profile("p"),
  };
  const m = mergeSnapshots(local, EMPTY_SNAPSHOT);
  assert.deepEqual(m.status, { A: "must" });
  assert.deepEqual(m.order.must, ["A"]);
  assert.deepEqual(m.comments, { A: "keep across first login" });
  assert.equal(m.profile?.label, "p");
});

test("mergeSnapshots is idempotent and non-destructive: merge(merged, merged) == merged", () => {
  const local: PersonalSnapshot = {
    status: { A: "must", B: "skip" },
    order: { must: ["A"] },
    comments: { A: "local", B: "local shared" },
    profile: profile("x"),
  };
  const cloud: PersonalSnapshot = {
    status: { B: "maybe", C: "look" },
    order: { must: ["C"] },
    comments: { B: "cloud shared", C: "cloud" },
    profile: profile("y"),
  };
  const localBefore = structuredClone(local);
  const cloudBefore = structuredClone(cloud);
  const merged = mergeSnapshots(local, cloud);
  const again = mergeSnapshots(merged, merged);
  assert.ok(snapshotsEqual(merged, again));
  assert.deepEqual(local, localBefore);
  assert.deepEqual(cloud, cloudBefore);
  assert.deepEqual(merged.comments, { A: "local", B: "cloud shared", C: "cloud" });
});

test("snapshotsEqual accepts equal comments and detects a comments-only difference", () => {
  const a: PersonalSnapshot = {
    status: { A: "must" },
    order: { must: ["A"] },
    comments: { A: "same" },
    profile: null,
  };
  const b: PersonalSnapshot = {
    status: { A: "must" },
    order: { must: ["A"] },
    comments: { A: "same" },
    profile: null,
  };
  const c: PersonalSnapshot = {
    status: { A: "must" },
    order: { must: ["A"] },
    comments: { A: "different" },
    profile: null,
  };
  assert.ok(snapshotsEqual(a, b));
  assert.ok(!snapshotsEqual(a, c));
});
