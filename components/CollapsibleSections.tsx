"use client";

import { ReactNode, useEffect, useState } from "react";

// The ตั้งค่าระบบ tab holds what used to be four tabs. Each group folds, so
// the tab opens as a short list of headings rather than a long page, and a
// group's panels are only mounted (and only fetch) once it has been opened.
// Which groups are open is remembered in this browser.

export interface Section {
  id: string;
  title: string;
  hint?: string;
  content: ReactNode;
}

const STORAGE_KEY = "settings-sections-open";

function readOpen(): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeOpen(open: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...open]));
  } catch {
    // Private windows and blocked storage: the page still works, it just
    // will not remember.
  }
}

export default function CollapsibleSections({
  sections,
  defaultOpen = [],
}: {
  sections: Section[];
  defaultOpen?: string[];
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen));
  // Mounted once opened, then kept: closing a group hides it without
  // throwing away what was typed or loaded in it.
  const [mounted, setMounted] = useState<Set<string>>(() => new Set(defaultOpen));

  useEffect(() => {
    const saved = readOpen();
    if (saved) {
      setOpen(saved);
      setMounted((m) => new Set([...m, ...saved]));
    }
  }, []);

  const update = (next: Set<string>) => {
    setOpen(next);
    setMounted((m) => new Set([...m, ...next]));
    writeOpen(next);
  };

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-3 text-xs text-slate-500">
        <button type="button" className="hover:text-slate-800" onClick={() => update(new Set(sections.map((s) => s.id)))}>
          ขยายทั้งหมด
        </button>
        <span>·</span>
        <button type="button" className="hover:text-slate-800" onClick={() => update(new Set())}>
          ย่อทั้งหมด
        </button>
      </div>
      {sections.map((s) => {
        const isOpen = open.has(s.id);
        return (
          <section key={s.id}>
            <button
              type="button"
              onClick={() => toggle(s.id)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 px-4 py-3 text-left bg-white rounded-lg shadow hover:bg-slate-50"
            >
              <span className={`text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
              <span className="font-semibold">{s.title}</span>
              {s.hint && <span className="text-xs text-slate-500 hidden sm:inline">{s.hint}</span>}
            </button>
            {mounted.has(s.id) && (
              <div className={isOpen ? "pt-3 pb-2 space-y-6" : "hidden"}>{s.content}</div>
            )}
          </section>
        );
      })}
    </div>
  );
}
