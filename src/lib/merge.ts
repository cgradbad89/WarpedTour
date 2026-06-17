// Pure personal-state merge + coercion (PRD §12). NO Firebase, NO React, NO
// window — just data, so it's unit-testable on its own (tests/merge.test.ts) and
// reusable by the cloud layer. The store decides WHEN to merge; this decides HOW.
//
// A PersonalSnapshot is the whole of a user's writable state: picks (status),
// My-Picks ordering (order), and the uploaded taste profile (profile). It's the
// shape we mirror between localStorage and the per-user Firestore doc.

import type { BandStatus, OrderMap, StatusMap } from "@/types";
import type { TasteProfile } from "./scoring";
import { normalizeProfile } from "./storage";

export interface PersonalSnapshot {
  status: StatusMap;
  order: OrderMap;
  profile: TasteProfile | null;
}

/** Status sections in display/precedence order (mirrors storage's STATUSES). */
const STATUSES: readonly BandStatus[] = ["must", "maybe", "look", "skip"];
const VALID: ReadonlySet<string> = new Set<BandStatus>(STATUSES);

/** An empty snapshot — the baseline when neither side has data. */
export const EMPTY_SNAPSHOT: PersonalSnapshot = { status: {}, order: {}, profile: null };

/**
 * Defensively coerce arbitrary data (a Firestore doc, parsed JSON, anything)
 * into a valid PersonalSnapshot. Unknown / malformed fields are dropped, never
 * thrown — a hand-edited or partial cloud doc must not crash the app.
 */
export function coerceSnapshot(raw: unknown): PersonalSnapshot {
  if (!raw || typeof raw !== "object") return { status: {}, order: {}, profile: null };
  const obj = raw as Record<string, unknown>;

  const status: StatusMap = {};
  const s = obj.status;
  if (s && typeof s === "object") {
    for (const [name, val] of Object.entries(s as Record<string, unknown>)) {
      if (typeof val === "string" && VALID.has(val)) status[name] = val as BandStatus;
    }
  }

  const order: OrderMap = {};
  const o = obj.order;
  if (o && typeof o === "object") {
    for (const st of STATUSES) {
      const arr = (o as Record<string, unknown>)[st];
      if (Array.isArray(arr)) {
        const names = arr.filter((n): n is string => typeof n === "string");
        if (names.length) order[st] = names;
      }
    }
  }

  return { status, order, profile: normalizeProfile(obj.profile) };
}

/**
 * Merge a device's LOCAL snapshot into the established CLOUD snapshot on login
 * (PRD §12). The contract:
 *   - status: UNION of picks; on the SAME band, CLOUD wins (it's the established
 *             source). Never silently drops a local mark.
 *   - order:  per section, cloud order first, then any local-only names appended
 *             (deduped) — a sensible merge that respects the cloud's ordering.
 *   - profile: cloud if present, else local.
 *
 * Idempotent and non-destructive: merge(x, x) === x, and re-merging never deletes
 * a pick (union) nor reorders away the cloud's order. So repeated logins are safe.
 */
export function mergeSnapshots(
  local: PersonalSnapshot,
  cloud: PersonalSnapshot,
): PersonalSnapshot {
  const status: StatusMap = { ...local.status, ...cloud.status };

  const order: OrderMap = {};
  for (const st of STATUSES) {
    const cloudArr = cloud.order[st] ?? [];
    const localArr = local.order[st] ?? [];
    const seen = new Set(cloudArr);
    const merged = [...cloudArr];
    for (const n of localArr) {
      if (!seen.has(n)) {
        seen.add(n);
        merged.push(n);
      }
    }
    if (merged.length) order[st] = merged;
  }

  return { status, order, profile: cloud.profile ?? local.profile ?? null };
}

/**
 * Structural equality of two snapshots — lets the store skip a redundant cloud
 * write when a login-time merge produced nothing new (the common returning-user
 * case), which also avoids needlessly clobbering a concurrent remote write.
 */
export function snapshotsEqual(a: PersonalSnapshot, b: PersonalSnapshot): boolean {
  const ak = Object.keys(a.status);
  const bk = Object.keys(b.status);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a.status[k] !== b.status[k]) return false;

  for (const st of STATUSES) {
    const aa = a.order[st] ?? [];
    const bb = b.order[st] ?? [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  }

  return JSON.stringify(a.profile ?? null) === JSON.stringify(b.profile ?? null);
}
