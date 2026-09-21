"use client";

import { useEffect, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

// A filter that takes several answers at once.
//
// A dropdown asks "which หน่วยคุม", and the honest answer is often "these
// three" — the ones one person is chasing this week. Asked one at a time it
// takes three passes and three exports to see them together, and the totals
// under the table, which are the numbers staff act on, never add up to the
// three of them.
//
// Long lists (656 สังกัด) get a search box, because a list nobody can scan
// is a list nobody can tick.
export default function MultiSelect({
  options,
  selected,
  onChange,
  allLabel,
  searchPlaceholder,
  title,
  className = "",
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  // Shown when nothing is ticked, which means no filter at all.
  allLabel: string;
  searchPlaceholder?: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  // Clicking away closes it. Without this the panel stays over the table and
  // has to be dismissed by finding the button again.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    );

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options;

  // What is ticked, in the words on the button: one choice is worth naming,
  // and several are only worth counting.
  const summary =
    selected.length === 0
      ? `${allLabel} (${options.length})`
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `เลือกไว้ ${selected.length} จาก ${options.length}`;

  return (
    <div className={`relative ${className}`} ref={box}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        title={title}
        className={`border rounded-md px-2 py-1.5 bg-white text-left flex items-center gap-2 max-w-full ${
          selected.length > 0 ? "border-slate-900" : "border-slate-300"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="text-slate-400 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-72 max-w-[90vw] bg-white border border-slate-200 rounded-md shadow-lg">
          {options.length > 8 && (
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder ?? "ค้นหา"}
              className="w-full border-b border-slate-200 px-3 py-2 text-sm focus:outline-none"
            />
          )}
          <div className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-400">ไม่พบ &quot;{query}&quot;</p>
            )}
            {shown.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  className="mt-0.5 shrink-0"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-between border-t border-slate-200 px-3 py-1.5 text-xs">
            <button
              type="button"
              onClick={() => onChange(shown.map((o) => o.value))}
              className="text-slate-500 hover:underline"
            >
              เลือกทั้งหมด{needle ? ` ที่ค้นเจอ (${shown.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-slate-500 hover:underline"
              disabled={selected.length === 0}
            >
              ล้าง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
