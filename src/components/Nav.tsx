"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Primary navigation tabs between the lineup ("/") and My Picks ("/picks").
// Shown in the header of both pages.

const TABS = [
  { href: "/", label: "Lineup" },
  { href: "/picks", label: "My Picks" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex shrink-0 gap-1" aria-label="Primary">
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
    </nav>
  );
}
