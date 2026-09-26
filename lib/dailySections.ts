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
//
// The rule for what counts as open lives in lib/sections.ts, shared with the
// เทียบ Statement tab; this file is only this tab's sections and defaults.

import { openAll } from "./sections";

export { sectionOpen, type SectionState } from "./sections";

export type SectionKey =
  | "report"
  | "statement"
  | "matched"
  | "slipsWithoutMoney"
  | "unknownPayer"
  | "knownPayer"
  | "splitDeposits"
  | "otherLines";

export const SECTION_KEYS: SectionKey[] = [
  "report",
  "statement",
  "matched",
  "slipsWithoutMoney",
  "unknownPayer",
  "knownPayer",
  "splitDeposits",
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
  // Short, and where staff look to check who got what after dividing a
  // unit's transfer.
  splitDeposits: true,
  otherLines: false,
};

// Every section at once, for the ขยายทั้งหมด / ย่อทั้งหมด pair.
export function allSections(open: boolean): Record<SectionKey, boolean> {
  return openAll(SECTION_KEYS, open);
}
