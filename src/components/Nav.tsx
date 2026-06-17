"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthButton } from "./AuthButton";

// Shared top nav STRIP — identical on every page (the mobile header redesign's
// core fix). ONE row: the three routes on the LEFT as a single compact segmented
// control (reads as one horizontal strip, never a 2x2 grid even at 375px), and
// the optional account control on the RIGHT (avatar only on mobile; avatar + name
// on desktop, via AuthButton). AuthButton renders nothing when logged out before
// mount or when Firebase isn't configured, so the strip is identical to the
// pre-auth app. "My Picks" is shortened to "Picks" so all three tabs fit on one
// line on a phone.

const TABS = [
  { href: "/", label: "Lineup" },
  { href: "/picks", label: "Picks" },
  { href: "/schedule", label: "Schedule" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center justify-between gap-2" aria-label="Primary">
      {/* Segmented tab strip: one connected control, tabs sized to content. */}
      <div className="inline-flex items-center gap-0.5 rounded-full bg-muted p-0.5">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[44px] items-center rounded-full px-3 text-sm font-semibold transition-colors ${
                active
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <AuthButton />
    </nav>
  );
}
