"use client";

// Optional sign-in control for the header (PRD §12). Signed out → a "Sign in"
// button (Google popup). Signed in → the account avatar + a small menu with the
// name/email and "Sign out". When Firebase isn't configured it renders NOTHING,
// so the header is identical to the pre-auth app — login is purely additive.
//
// SSR-safety: renders null until mounted, so the server and first client render
// agree (no hydration mismatch) before auth state resolves.

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Avatar } from "./Avatar";

export function AuthButton() {
  const { user, ready, available, signIn, signOut } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Close the account menu on outside-click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Pre-mount or no Firebase → render nothing (header == pre-auth app).
  if (!mounted || !available) return null;

  const pill =
    "inline-flex min-h-[44px] items-center justify-center rounded-full px-3 text-sm font-semibold transition-colors";

  if (!ready) {
    // Auth still resolving — a stable placeholder avoids a layout jump.
    return (
      <span className={`${pill} text-muted-foreground/40`} aria-hidden="true">
        ···
      </span>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={async () => {
          setBusy(true);
          await signIn();
          setBusy(false);
        }}
        disabled={busy}
        className={`${pill} bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-60`}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    );
  }

  const fullName = user.displayName ?? user.email ?? "Account";
  const firstName = (user.displayName ?? user.email ?? "Account").split(/\s+/)[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${fullName}`}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors hover:bg-muted lg:min-w-0 lg:justify-start lg:gap-1.5 lg:py-1 lg:pl-1 lg:pr-2.5 lg:ring-1 lg:ring-inset lg:ring-border"
      >
        <Avatar name={fullName} image={user.photoURL ?? ""} size={32} />
        {/* Name is the biggest space waster on a phone — desktop only (lg+). */}
        <span className="hidden max-w-[8rem] truncate text-sm font-semibold lg:inline">
          {firstName}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-60 rounded-xl border border-border bg-background p-3 shadow-lg"
        >
          <p className="truncate text-sm font-bold leading-tight">{fullName}</p>
          {user.email && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Your picks &amp; uploaded taste sync to this account across devices.
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
            className="mt-2.5 min-h-[40px] w-full rounded-lg px-3 text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border transition-colors hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
