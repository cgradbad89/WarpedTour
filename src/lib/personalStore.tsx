"use client";

// The single owner of the user's writable state — picks (status), My-Picks order,
// and the uploaded taste profile — and the seam that makes storage local-or-cloud
// WITHOUT the rest of the app caring (PRD §12). usePersonalState and useProfile
// are thin readers over this provider, so their contracts are unchanged.
//
// Logged OUT (or Firebase unavailable): pure localStorage — byte-for-byte the
// app as it has always behaved. No network, no auth, no gating.
//
// Logged IN: on login the device's local snapshot is merged into the Firestore
// per-user doc (union of picks, cloud wins conflicts — never loses a mark; see
// merge.ts), then reads/writes flow through Firestore with localStorage kept as a
// mirror/offline cache. A live subscription syncs other devices in. Signing out
// leaves that cache in place, so it returns to logged-out behavior with no loss.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BandStatus, CommentMap, OrderMap, StatusMap } from "@/types";
import type { TasteProfile } from "./scoring";
import {
  clearStoredProfile,
  loadComments,
  loadOrder,
  loadProfile,
  loadStatus,
  removeFromOrder,
  saveComments,
  saveOrder,
  saveProfile,
  saveStatus,
  setBandStatus,
} from "./storage";
import {
  EMPTY_SNAPSHOT,
  mergeSnapshots,
  snapshotsEqual,
  type PersonalSnapshot,
} from "./merge";
import {
  cloudAvailable,
  loadCloudSnapshot,
  saveCloudSnapshot,
  subscribeCloudSnapshot,
} from "./cloud";
import { useAuth } from "./auth";

export interface PersonalStore {
  status: StatusMap;
  order: OrderMap;
  profile: TasteProfile | null;
  /** True once localStorage has been read on the client (mirrors useProfile.ready). */
  profileReady: boolean;
  pickCount: number;
  comments: CommentMap;
  changeStatus: (name: string, next: BandStatus | null) => void;
  setSectionOrder: (status: BandStatus, names: string[]) => void;
  resetSectionOrder: (status: BandStatus) => void;
  clearAll: () => void;
  setProfile: (profile: TasteProfile) => void;
  clearProfile: () => void;
  setComment: (name: string, comment: string) => void;
}

// Safe logged-out default if a consumer is ever used outside the provider (it
// isn't in the app — layout wraps everything — but this keeps SSR/tests robust).
const DEFAULT_STORE: PersonalStore = {
  status: {},
  order: {},
  profile: null,
  profileReady: false,
  pickCount: 0,
  comments: {},
  changeStatus: () => {},
  setSectionOrder: () => {},
  resetSectionOrder: () => {},
  clearAll: () => {},
  setProfile: () => {},
  clearProfile: () => {},
  setComment: () => {},
};

const StoreContext = createContext<PersonalStore | null>(null);

export function PersonalStoreProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  const [core, setCore] = useState<PersonalSnapshot>(EMPTY_SNAPSHOT);
  const [profileReady, setProfileReady] = useState(false);

  // Mirror the latest core + uid in refs so async cloud callbacks and mutation
  // builders read current values without re-subscribing or stale closures.
  const coreRef = useRef<PersonalSnapshot>(EMPTY_SNAPSHOT);
  const uidRef = useRef<string | null>(null);

  // Apply a snapshot to memory + the localStorage mirror, WITHOUT writing cloud.
  // Used for the initial load, remote (subscription) updates, and as the base of
  // a local commit. localStorage is always kept in sync so logout retains data.
  const applyLocalCache = useCallback((next: PersonalSnapshot) => {
    coreRef.current = next;
    setCore(next);
    saveStatus(next.status);
    saveOrder(next.order);
    saveComments(next.comments);
    if (next.profile) saveProfile(next.profile);
    else clearStoredProfile();
  }, []);

  // A local mutation: update memory + localStorage, and push to cloud if signed in.
  const commit = useCallback(
    (next: PersonalSnapshot) => {
      applyLocalCache(next);
      const uid = uidRef.current;
      if (uid && cloudAvailable()) void saveCloudSnapshot(uid, next);
    },
    [applyLocalCache],
  );

  // 1) Initial client-only load from localStorage (SSR starts empty → no hydration
  //    mismatch). This is the logged-out path and runs before auth resolves, so a
  //    returning signed-in user still sees their cached data instantly.
  useEffect(() => {
    const local: PersonalSnapshot = {
      status: loadStatus(),
      order: loadOrder(),
      comments: loadComments(),
      profile: loadProfile(),
    };
    coreRef.current = local;
    setCore(local);
    setProfileReady(true);
  }, []);

  // 2) Cloud sync, keyed on the signed-in uid. Logged out / Firebase unavailable →
  //    no-op (stays on localStorage). On login: merge this device's local into the
  //    cloud doc, then live-subscribe for cross-device updates.
  const uid = auth.user?.uid ?? null;
  useEffect(() => {
    uidRef.current = uid;
    if (!uid || !cloudAvailable()) return;

    let active = true;
    let unsub = () => {};

    (async () => {
      const local: PersonalSnapshot = {
        status: loadStatus(),
        order: loadOrder(),
        comments: loadComments(),
        profile: loadProfile(),
      };
      const cloud = await loadCloudSnapshot(uid);
      if (!active) return;

      // Union local into cloud (cloud wins on conflict) — never drops a local mark.
      const merged = mergeSnapshots(local, cloud ?? EMPTY_SNAPSHOT);
      applyLocalCache(merged);

      // Write back only when the merge added something the cloud lacked. Skips a
      // redundant write — and a needless clobber of a concurrent remote write —
      // for the common returning-user case where local ⊆ cloud.
      if (!cloud || !snapshotsEqual(merged, cloud)) {
        await saveCloudSnapshot(uid, merged);
      }
      if (!active) return;

      unsub = subscribeCloudSnapshot(uid, (remote) => {
        if (active) applyLocalCache(remote); // remote-driven → mirror, don't echo back
      });
    })();

    return () => {
      active = false;
      unsub();
    };
  }, [uid, applyLocalCache]);

  const changeStatus = useCallback(
    (name: string, next: BandStatus | null) => {
      const cur = coreRef.current;
      commit({
        status: setBandStatus(cur.status, name, next),
        order: removeFromOrder(cur.order, name), // status change stales its order slot
        comments: cur.comments,
        profile: cur.profile,
      });
    },
    [commit],
  );

  const setSectionOrder = useCallback(
    (s: BandStatus, names: string[]) => {
      const cur = coreRef.current;
      commit({ ...cur, order: { ...cur.order, [s]: names } });
    },
    [commit],
  );

  const resetSectionOrder = useCallback(
    (s: BandStatus) => {
      const cur = coreRef.current;
      const order = { ...cur.order };
      delete order[s];
      commit({ ...cur, order });
    },
    [commit],
  );

  // Clears picks + order; leaves the uploaded profile and comments untouched.
  const clearAll = useCallback(() => {
    commit({ status: {}, order: {}, comments: coreRef.current.comments, profile: coreRef.current.profile });
  }, [commit]);

  const setProfile = useCallback(
    (profile: TasteProfile) => {
      commit({ ...coreRef.current, profile });
    },
    [commit],
  );

  const clearProfile = useCallback(() => {
    commit({ ...coreRef.current, profile: null });
  }, [commit]);

  const setComment = useCallback(
    (name: string, comment: string) => {
      const cur = coreRef.current;
      const nextComments = { ...cur.comments };
      if (!comment.trim()) {
        delete nextComments[name];
      } else {
        nextComments[name] = comment;
      }
      commit({ ...cur, comments: nextComments });
    },
    [commit],
  );

  const value = useMemo<PersonalStore>(
    () => ({
      status: core.status,
      order: core.order,
      profile: core.profile,
      profileReady,
      pickCount: Object.keys(core.status).length,
      comments: core.comments,
      changeStatus,
      setSectionOrder,
      resetSectionOrder,
      clearAll,
      setProfile,
      clearProfile,
      setComment,
    }),
    [
      core,
      profileReady,
      changeStatus,
      setSectionOrder,
      resetSectionOrder,
      clearAll,
      setProfile,
      clearProfile,
      setComment,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** Read the shared personal store. Safe logged-out default outside the provider. */
export function usePersonalStore(): PersonalStore {
  return useContext(StoreContext) ?? DEFAULT_STORE;
}
