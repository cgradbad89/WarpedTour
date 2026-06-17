"use client";

// Optional Google authentication (PRD §12). Logged-OUT is the default and is the
// entire app today — auth is purely additive. When Firebase is unavailable
// (missing env, init failure, SSR) this degrades to a permanent logged-out state
// with no-op sign-in, so the app never gates or white-screens on auth.
//
// SSR-safety: `available`, `user`, and `ready` all start at their logged-out
// values on the server AND the first client render, then resolve in an effect —
// so there's no hydration mismatch. UI that depends on auth state (AuthButton)
// additionally guards on a mounted flag.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { getFirebase } from "./firebase";

export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface AuthState {
  /** The signed-in user, or null when logged out / unavailable. */
  user: AuthUser | null;
  /** True once the auth state has resolved (or auth is unavailable). */
  ready: boolean;
  /** True when Firebase Auth is configured and usable in this environment. */
  available: boolean;
  /** Open the Google sign-in popup. No-op when unavailable; never throws. */
  signIn: () => Promise<void>;
  /** Sign out. No-op when unavailable; never throws. */
  signOut: () => Promise<void>;
}

const LOGGED_OUT: AuthState = {
  user: null,
  ready: true,
  available: false,
  signIn: async () => {},
  signOut: async () => {},
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const fb = getFirebase();
    setAvailable(fb !== null);
    if (!fb) {
      setReady(true); // no auth here → resolved, logged out
      return;
    }
    const unsub = onAuthStateChanged(fb.auth, (u) => {
      setUser(
        u
          ? {
              uid: u.uid,
              displayName: u.displayName,
              email: u.email,
              photoURL: u.photoURL,
            }
          : null,
      );
      setReady(true);
    });
    return unsub;
  }, []);

  const signIn = useCallback(async () => {
    const fb = getFirebase();
    if (!fb) return;
    try {
      await signInWithPopup(fb.auth, new GoogleAuthProvider());
    } catch (err) {
      // Popup closed, blocked, or cancelled — non-fatal; stay logged out.
      console.warn("[auth] sign-in failed", err);
    }
  }, []);

  const signOut = useCallback(async () => {
    const fb = getFirebase();
    if (!fb) return;
    try {
      await firebaseSignOut(fb.auth);
    } catch (err) {
      console.warn("[auth] sign-out failed", err);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, ready, available, signIn, signOut }),
    [user, ready, available, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Read auth state. Returns a safe logged-out default if used outside the provider. */
export function useAuth(): AuthState {
  return useContext(AuthContext) ?? LOGGED_OUT;
}
