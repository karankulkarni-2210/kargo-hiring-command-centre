"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: "M3 12h7V3H3zM14 21h7v-9h-7zM14 3v5h7V3zM3 21h7v-5H3z" },
  { href: "/upload", label: "Upload CVs", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" },
  { href: "/rubric", label: "Rubric", icon: "M4 6h16M4 12h10M4 18h7M18 15l2 2 3-4" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 004.6 15H4.5a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0011 4.6V4.5a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8" },
];

export function Nav({ horizontal }: { horizontal?: boolean }) {
  const path = usePathname();
  return (
    <nav className={cx(horizontal ? "flex gap-1 overflow-x-auto px-3 py-2" : "space-y-0.5 px-3")}>
      {ITEMS.map((it) => {
        const active = it.href === "/" ? path === "/" || path.startsWith("/candidates") : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cx(
              "focus-ring group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
              active ? "bg-accent/12 text-text shadow-[inset_2px_0_0_#4f7dff]" : "text-muted hover:bg-surface-3 hover:text-text",
            )}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-accent-strong" : ""}>
              <path d={it.icon} />
            </svg>
            <span className="whitespace-nowrap">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
