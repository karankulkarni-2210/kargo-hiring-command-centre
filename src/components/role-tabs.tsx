"use client";

import { useState, type ReactNode } from "react";
import { cx } from "./ui";

export function Tabs({ tabs, initial }: { tabs: { key: string; label: ReactNode; content: ReactNode }[]; initial: string }) {
  const [active, setActive] = useState(initial);
  return (
    <div>
      <div role="tablist" className="mb-4 inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={cx("focus-ring rounded-md px-3 py-1.5 text-xs font-medium transition-colors", active === t.key ? "bg-surface-3 text-text shadow-[0_0_0_1px_#283344]" : "text-muted hover:text-text")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" hidden={active !== t.key} className="animate-rise">
          {t.content}
        </div>
      ))}
    </div>
  );
}
