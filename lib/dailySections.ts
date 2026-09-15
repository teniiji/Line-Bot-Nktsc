// Which parts of the daily view are open, and why.
//
// The tab is a stack of seven findings, and on a real day they are not the
// same size: 122 matched rows and 326 with no slip, against one stray slip
// that actually needs somebody. Rendering every one of them open turned the
// page into several thousand pixels of table, so getting from the one-line
// question to the section that answers it meant scrolling past the two
// sections that did not.
//
// So every section folds, and the ones that open by themselves are the ones
// with work in them. "ตรงกัน" says on its own face that there is nothing to
// do about it, and it is usually the longest list on the page — it stays
// folded until somebody asks for it.

export type SectionKey =
  | "report"
  | "statement"
  | "matched"
  | "slipsWithoutMoney"
  | "unknownPayer"
  | "knownPayer"
  | "otherLines";

export const SECTION_KEYS: SectionKey[] = [
  "report",
  "statement",
  "matched",
  "slipsWithoutMoney",
  "unknownPayer",
  "knownPayer",
  "otherLines",
];

// Open on arrival: a slip with no money behind it, and money nobody can put a
// name to. Both are lists of things a person has to do something about, and
// both are short on an ordinary day. Everything else is a reference — true,
// worth having, and not what the page is opened for.
export const SECTION_OPEN_BY_DEFAULT: Record<SectionKey, boolean> = {
  report: false,
  statement: false,
  matched: false,
  slipsWithoutMoney: true,
  unknownPayer: true,
  knownPayer: false,
  otherLines: false,
};

export interface SectionState {
  // What this person last clicked on this section, if anything. Undefined
  // until they touch it, which is what lets the two rules below apply.
  clicked?: boolean;
  searching: boolean;
  // Rows in this section that match the search.
  matches: number;
}

// Whether a section is showing its rows.
//
// A click wins while it stands — having asked for a section to be shut, a
// person should not find it open again because of something else on the page.
// It stands until the search box changes, which is the panel's job (see
// DailyReconcilePanel): a new search makes every section a different list, so
// what was clicked about the old one no longer means anything.
//
// Failing a click, a search opens whatever it found. Searching a page whose
// sections are folded is otherwise a trap: the header counts the hits, the
// rows stay hidden, and the obvious reading is that the box found nothing —
// which is exactly what ย่อทั้งหมด followed by a search did before the clicks
// were cleared, since it had written seven deliberate-looking closes.
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
// explicit clicks on all seven rather than as a mode, so one of them can be
// folded again straight afterwards without the rest springing open.
export function allSections(open: boolean): Record<SectionKey, boolean> {
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, open])) as Record<
    SectionKey,
    boolean
  >;
}
