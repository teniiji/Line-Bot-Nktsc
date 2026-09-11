"use client";

import { ReactNode } from "react";

// The paragraph under a panel's heading.
//
// These explain things worth explaining — which of five conclusions a bank
// line landed under, what the import reads out of a file, why a figure is a
// guess — and staff read them once, understand the tab, and then look past
// them every day for the rest of the year. Left open, four or five lines of
// 12px grey sit above every table, pushing the work itself down the page; and
// the size that made them unobtrusive is the size that makes them hard to
// read on the day somebody does need them.
//
// So: one line always, the rest a click away, and bigger and darker when it
// is open than it was when it was permanent. A native <details> rather than
// state, so it opens from the keyboard and is found by the browser's own
// find-on-page while still closed.
export default function PanelHelp({
  summary,
  children,
}: {
  // The one line that stays on screen. Say what the panel is for; leave the
  // rules, the caveats and the file formats to the part that opens.
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group mt-1">
      <summary className="text-xs text-slate-500 cursor-pointer list-none marker:content-none hover:text-slate-700">
        {summary}{" "}
        <span className="text-slate-400 underline underline-offset-2 whitespace-nowrap">
          <span className="group-open:hidden">ดูรายละเอียด</span>
          <span className="hidden group-open:inline">ซ่อนรายละเอียด</span>
        </span>
      </summary>
      <div className="text-sm text-slate-600 mt-2 space-y-2 max-w-3xl">{children}</div>
    </details>
  );
}
