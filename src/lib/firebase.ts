// Client-only Firebase initialisation (PRD §12). Reads the public web config
// from process.env.NEXT_PUBLIC_FIREBASE_* (inlined at build time; never hardcoded
// here). These values are public-by-design — the Firebase web SDK config ships to
// the browser and access is gated by Firestore security rules, not secrecy.
//
// Hard guarantees so the app NEVER white-screens on auth (PRD §12, sharp edges):
//   - SSR-safe: returns null on the server (no window) — init only ever runs in
//     the browser, so importing this module during SSR is inert.
//   - Degrades to null if config is missing/blank or init throws. Callers treat
//     null as "auth unavailable" and fall back to the logged-out localStorage app.
//
// Only firebase/app, firebase/auth, firebase/firestore are imported (CLAUDE.md).

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

function readConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

// Memoised singleton. `undefined` = not yet attempted; `null` = unavailable.
let services: FirebaseServices | null | undefined;

/**
 * Get the initialised Firebase services, or null when Firebase can't run here
 * (server-side, missing env, or init failure). Safe to call anywhere; the result
 * is cached after the first attempt.
 */
export function getFirebase(): FirebaseServices | null {
  if (services !== undefined) return services;
  if (typeof window === "undefined") return null; // SSR — don't cache; retry on client

  const cfg = readConfig();
  // The web SDK needs at least these three; a blank .env means "no auth" → null.
  if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId) {
    services = null;
    return services;
  }

  try {
    const app = getApps().length ? getApp() : initializeApp(cfg);
    services = { app, auth: getAuth(app), db: getFirestore(app) };
  } catch (err) {
    // Never let a Firebase init error take down the page — log and degrade.
    console.warn("[firebase] init failed; running in logged-out mode.", err);
    services = null;
  }
  return services;
}

/** True when Firebase is configured + initialised in this (browser) environment. */
export function isFirebaseAvailable(): boolean {
  return getFirebase() !== null;
}
