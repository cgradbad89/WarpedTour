"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Primary navigation tabs between the lineup ("/"), My Picks ("/picks"), and the
// predicted Schedule ("/schedule"). Shown in the header of every page. Wraps if
// the three tabs don't fit beside the page title on a narrow phone.

const TABS = [
  { href: "/", label: "Lineup" },
  { href: "/picks", label: "My Picks" },
  { href: "/schedule", label: "Schedule" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap justify-end gap-1" aria-label="Primary">
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
