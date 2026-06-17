// Firestore sync for a signed-in user's personal state (PRD §12).
//
// NAMESPACING (do not break — the "wdnnsp" Firebase project is SHARED with
// another app): this app only ever touches ONE collection, `warped_users`, with
// one document per user keyed by their auth uid: `warped_users/{uid}`. It never
// reads or writes the root or any other collection. The security rules (output in
// firestore.rules, deployed manually) restrict each doc to its owner.
//
// STORAGE SHAPE: the whole PersonalSnapshot is stored as a single JSON STRING
// field (`data`), not as structured Firestore maps. Band names — which are the
// keys of the `status` map — contain punctuation Firestore disallows in nested
// map keys (e.g. "Letlive.", "The Academy Is...", "Drop Dead, Gorgeous"). A JSON
// blob sidesteps every map-key constraint; the doc is only ever read whole by
// uid, never queried, so there's no downside.

import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getFirebase } from "./firebase";
import { coerceSnapshot, type PersonalSnapshot } from "./merge";

/** The single namespaced collection this app owns (PRD §12). */
const COLLECTION = "warped_users";
const SCHEMA_VERSION = 1;

/** True when Firestore can be used here (Firebase configured + in the browser). */
export function cloudAvailable(): boolean {
  return getFirebase() !== null;
}

/** Read a user's snapshot from `warped_users/{uid}`. null = no doc yet / error. */
export async function loadCloudSnapshot(uid: string): Promise<PersonalSnapshot | null> {
  const fb = getFirebase();
  if (!fb) return null;
  try {
    const snap = await getDoc(doc(fb.db, COLLECTION, uid));
    if (!snap.exists()) return null;
    return parseDoc(snap.data());
  } catch (err) {
    console.warn("[cloud] loadCloudSnapshot failed", err);
    return null;
  }
}

/** Write a user's whole snapshot to `warped_users/{uid}` (overwrites the doc). */
export async function saveCloudSnapshot(
  uid: string,
  snapshot: PersonalSnapshot,
): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;
  try {
    await setDoc(doc(fb.db, COLLECTION, uid), {
      data: JSON.stringify(snapshot),
      schemaVersion: SCHEMA_VERSION,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    // Never throw into the UI — a failed sync just leaves localStorage as the cache.
    console.warn("[cloud] saveCloudSnapshot failed", err);
  }
}

/**
 * Live-subscribe to `warped_users/{uid}` for cross-device sync. `onChange` fires
 * with the coerced remote snapshot whenever the doc changes (including the local
 * latency-compensated echo of our own writes — harmless, it's the same data).
 * Returns an unsubscribe fn; a no-op when Firebase is unavailable.
 */
export function subscribeCloudSnapshot(
  uid: string,
  onChange: (snapshot: PersonalSnapshot) => void,
): () => void {
  const fb = getFirebase();
  if (!fb) return () => {};
  try {
    return onSnapshot(
      doc(fb.db, COLLECTION, uid),
      (snap) => {
        if (!snap.exists()) return; // doc not created yet → nothing to apply
        onChange(parseDoc(snap.data()));
      },
      (err) => console.warn("[cloud] subscribe error", err),
    );
  } catch (err) {
    console.warn("[cloud] subscribeCloudSnapshot failed", err);
    return () => {};
  }
}

/** Parse the JSON-blob doc back into a validated snapshot (defensive). */
function parseDoc(data: unknown): PersonalSnapshot {
  const raw = (data as { data?: unknown } | undefined)?.data;
  if (typeof raw !== "string") return coerceSnapshot(data); // legacy/structured fallback
  try {
    return coerceSnapshot(JSON.parse(raw));
  } catch {
    return { status: {}, order: {}, profile: null };
  }
}
