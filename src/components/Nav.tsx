"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthButton } from "./AuthButton";

// Primary navigation tabs between the lineup ("/"), My Picks ("/picks"), and the
// predicted Schedule ("/schedule"), plus the optional sign-in control (PRD §12).
// Shown in the header of every page. Wraps if the tabs + auth control don't fit
// beside the page title on a narrow phone. AuthButton renders nothing when
// logged out before mount or when Firebase isn't configured, so the nav is
// identical to the pre-auth app.

const TABS = [
  { href: "/", label: "Lineup" },
  { href: "/picks", label: "My Picks" },
  { href: "/schedule", label: "Schedule" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center justify-end gap-1" aria-label="Primary">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      <AuthButton />
    </nav>
  );
}
