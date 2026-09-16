import { describe, expect, it } from "vitest";
import {
  STATEMENT_SECTION_KEYS,
  STATEMENT_SECTION_OPEN_BY_DEFAULT,
  STATEMENT_SECTION_SEARCHABLE,
  allStatementSections,
} from "../lib/statementSections";
import { sectionOpen } from "../lib/sections";

const state = (over: Partial<Parameters<typeof sectionOpen>[0]> = {}) => ({
  searching: false,
  matches: 0,
  ...over,
});

describe("STATEMENT_SECTION_OPEN_BY_DEFAULT", () => {
  it("opens the round and the money nobody can name, folds the ruled-out", () => {
    // The tab is opened to read the round and to work through the unknown
    // payers. The excluded list is decisions already taken.
    expect(STATEMENT_SECTION_OPEN_BY_DEFAULT.members).toBe(true);
    expect(STATEMENT_SECTION_OPEN_BY_DEFAULT.unmatched).toBe(true);
    expect(STATEMENT_SECTION_OPEN_BY_DEFAULT.excluded).toBe(false);
  });

  it("has an answer for every section, so none can render undefined", () => {
    for (const key of STATEMENT_SECTION_KEYS) {
      expect(typeof STATEMENT_SECTION_OPEN_BY_DEFAULT[key]).toBe("boolean");
      expect(typeof STATEMENT_SECTION_SEARCHABLE[key]).toBe("boolean");
    }
  });
});

describe("STATEMENT_SECTION_SEARCHABLE", () => {
  it("marks only the member list, which is all the search box filters", () => {
    expect(STATEMENT_SECTION_SEARCHABLE.members).toBe(true);
    expect(STATEMENT_SECTION_SEARCHABLE.unmatched).toBe(false);
    expect(STATEMENT_SECTION_SEARCHABLE.excluded).toBe(false);
  });

  it("leaves an unsearchable section on its default while somebody types", () => {
    // The panel passes searching: false for these, so a section the search
    // never filtered does not fold itself for matching nothing. Typing a name
    // must not shut the unknown-payer list, which is where the account being
    // looked up usually is.
    const searching = STATEMENT_SECTION_SEARCHABLE.unmatched && true;
    expect(
      sectionOpen(
        state({ searching, matches: 0 }),
        STATEMENT_SECTION_OPEN_BY_DEFAULT.unmatched
      )
    ).toBe(true);
  });

  it("still folds the member list when a search finds nobody in it", () => {
    const searching = STATEMENT_SECTION_SEARCHABLE.members && true;
    expect(
      sectionOpen(state({ searching, matches: 0 }), STATEMENT_SECTION_OPEN_BY_DEFAULT.members)
    ).toBe(false);
  });
});

describe("allStatementSections", () => {
  it("names every section, so none is left on its own default", () => {
    const opened = allStatementSections(true);
    expect(Object.keys(opened).sort()).toEqual([...STATEMENT_SECTION_KEYS].sort());
    expect(Object.values(opened).every((v) => v === true)).toBe(true);
  });

  it("closes every section too, including the ones open by default", () => {
    const shut = allStatementSections(false);
    expect(Object.values(shut).every((v) => v === false)).toBe(true);
    expect(
      sectionOpen(
        { clicked: shut.unmatched, searching: false, matches: 0 },
        STATEMENT_SECTION_OPEN_BY_DEFAULT.unmatched
      )
    ).toBe(false);
  });

  it("writes explicit clicks, so one can be folded again straight after", () => {
    // Recorded as clicks rather than as a mode: after ขยายทั้งหมด, folding
    // the member list must not spring the other two open.
    const opened = allStatementSections(true);
    expect(
      sectionOpen(
        { clicked: opened.excluded, searching: false, matches: 0 },
        STATEMENT_SECTION_OPEN_BY_DEFAULT.excluded
      )
    ).toBe(true);
  });
});
