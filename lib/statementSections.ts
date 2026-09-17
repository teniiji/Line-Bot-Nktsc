// Which parts of the เทียบ Statement tab are open, and why.
//
// Three tables, stacked, and on a real round none of them is small: 1,173
// people in the round's list, 383 transfers nobody has put a name to under
// it, and the ruled-out money under that. The list staff work through by hand
// — the unknown payers, one "ระบุเจ้าของ" at a time — sits below a thousand
// rows they were not reading, and every save re-renders the page at the top
// of them.
//
// So each of the three folds, with the count on the heading so a folded one
// still says how much is inside. The rule for what counts as open is shared
// with the daily tab — see lib/sections.ts.

import { openAll } from "./sections";

export type StatementSectionKey = "members" | "unmatched" | "outsideRound" | "excluded";

export const STATEMENT_SECTION_KEYS: StatementSectionKey[] = [
  "members",
  "unmatched",
  "outsideRound",
  "excluded",
];

// Open on arrival: the round's own list, which is what the tab is for and
// what every filter, total and the CSV button above it act on; and the
// transfers with no owner, which is the work. The ruled-out money is a
// record of decisions already taken — true, worth keeping, and not what the
// tab is opened for.
export const STATEMENT_SECTION_OPEN_BY_DEFAULT: Record<StatementSectionKey, boolean> = {
  members: true,
  unmatched: true,
  // Owner already written down, member not on this round's list: the work on
  // these rows is done and the round has nothing to do with the money. It is
  // kept, and counted on its heading, but it does not open by itself.
  outsideRound: false,
  excluded: false,
};

// Which sections the search box reaches. It filters the round's member list
// only, so the other two must not fold themselves for matching nothing —
// they were never asked. See sectionOpen.
export const STATEMENT_SECTION_SEARCHABLE: Record<StatementSectionKey, boolean> = {
  members: true,
  unmatched: false,
  outsideRound: false,
  excluded: false,
};

// Every section at once, for the ขยายทั้งหมด / ย่อทั้งหมด pair.
export function allStatementSections(open: boolean): Record<StatementSectionKey, boolean> {
  return openAll(STATEMENT_SECTION_KEYS, open);
}
