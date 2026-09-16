// Whether a foldable section on a dashboard tab is showing its rows.
//
// Both reconcile tabs are a stack of tables that run to hundreds of rows each,
// so both fold, and the rule for what is open is the same on either — it was
// written for เงินเข้าประจำวัน (lib/dailySections.ts) and lifted here when
// เทียบ Statement needed it too (lib/statementSections.ts). The section names,
// and which of them open on arrival, stay with each tab; only the rule lives
// here.

export interface SectionState {
  // What this person last clicked on this section, if anything. Undefined
  // until they touch it, which is what lets the two rules below apply.
  clicked?: boolean;
  searching: boolean;
  // Rows in this section that match the search.
  matches: number;
}

// A click wins while it stands — having asked for a section to be shut, a
// person should not find it open again because of something else on the page.
// It stands until the search text changes, which is the panel's job: a new
// search makes every section a different list, so what was clicked about the
// old one no longer means anything.
//
// Failing a click, a search opens whatever it found. Searching a page whose
// sections are folded is otherwise a trap: the header counts the hits, the
// rows stay hidden, and the obvious reading is that the box found nothing —
// which is exactly what ย่อทั้งหมด followed by a search did before the clicks
// were cleared, since it had written a deliberate-looking close on every
// section.
//
// A section the search box does not reach passes searching: false, so its
// default stands rather than folding for want of hits it could never have.
export function sectionOpen(state: SectionState, fallback: boolean): boolean {
  if (state.clicked !== undefined) return state.clicked;
  // While searching, the page is the result: the sections that found
  // something are open and the rest are out of the way. A section that
  // matched nothing but happens to open by default would otherwise sit there
  // as a column of headings with no rows under them.
  if (state.searching) return state.matches > 0;
  return fallback;
}

// Every section at once, for the ขยายทั้งหมด / ย่อทั้งหมด pair. Written as
// explicit clicks on all of them rather than as a mode, so one can be folded
// again straight afterwards without the rest springing open.
export function openAll<Key extends string>(
  keys: readonly Key[],
  open: boolean
): Record<Key, boolean> {
  return Object.fromEntries(keys.map((key) => [key, open])) as Record<Key, boolean>;
}
