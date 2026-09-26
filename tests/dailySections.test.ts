import { describe, expect, it } from "vitest";
import {
  SECTION_KEYS,
  SECTION_OPEN_BY_DEFAULT,
  allSections,
  sectionOpen,
} from "../lib/dailySections";

const state = (over: Partial<Parameters<typeof sectionOpen>[0]> = {}) => ({
  searching: false,
  matches: 0,
  ...over,
});

describe("SECTION_OPEN_BY_DEFAULT", () => {
  it("opens the two lists with work in them and folds the rest", () => {
    // 122 matched rows and 326 with no slip, against one stray slip that
    // actually needs somebody. Opening all of it buried the short list.
    expect(SECTION_OPEN_BY_DEFAULT.slipsWithoutMoney).toBe(true);
    expect(SECTION_OPEN_BY_DEFAULT.unknownPayer).toBe(true);
    expect(SECTION_OPEN_BY_DEFAULT.matched).toBe(false);
  });

  it("has an answer for every section, so none can render undefined", () => {
    for (const key of SECTION_KEYS) {
      expect(typeof SECTION_OPEN_BY_DEFAULT[key]).toBe("boolean");
    }
  });
});

describe("sectionOpen", () => {
  it("follows the default until somebody touches it", () => {
    expect(sectionOpen(state(), true)).toBe(true);
    expect(sectionOpen(state(), false)).toBe(false);
  });

  it("lets a click win over the default, in both directions", () => {
    expect(sectionOpen(state({ clicked: false }), true)).toBe(false);
    expect(sectionOpen(state({ clicked: true }), false)).toBe(true);
  });

  it("opens a folded section that the search found something in", () => {
    // The trap this avoids: the header counts the hits, the rows stay
    // hidden, and the obvious reading is that the box found nothing.
    expect(sectionOpen(state({ searching: true, matches: 3 }), false)).toBe(true);
  });

  it("leaves a folded section alone when the search found nothing in it", () => {
    expect(sectionOpen(state({ searching: true, matches: 0 }), false)).toBe(false);
  });

  it("folds a section that matched nothing, even one open by default", () => {
    // While searching, the page is the result. An open section with no hits
    // renders as a row of column headings with nothing underneath.
    expect(sectionOpen(state({ searching: true, matches: 0 }), true)).toBe(false);
  });

  it("keeps a section somebody shut, even when the search finds rows in it", () => {
    // Having asked for a section to be shut, a person should not find it
    // open again because something they typed elsewhere disagreed.
    expect(sectionOpen(state({ clicked: false, searching: true, matches: 9 }), true)).toBe(
      false
    );
  });

  it("still opens a section a person asked for, search or no search", () => {
    expect(sectionOpen(state({ clicked: true, searching: true, matches: 0 }), false)).toBe(true);
  });
});

describe("allSections", () => {
  it("names every section, so none is left on its own default", () => {
    const opened = allSections(true);
    expect(Object.keys(opened).sort()).toEqual([...SECTION_KEYS].sort());
    expect(Object.values(opened).every((v) => v === true)).toBe(true);
  });

  it("writes explicit clicks, so one can be folded again straight after", () => {
    // Recorded as clicks rather than as a mode: after ขยายทั้งหมด, folding
    // one section must not spring the other six open.
    const opened = allSections(true);
    expect(sectionOpen({ clicked: opened.matched, searching: false, matches: 0 }, false)).toBe(
      true
    );
    expect(
      sectionOpen({ clicked: false, searching: false, matches: 0 }, SECTION_OPEN_BY_DEFAULT.matched)
    ).toBe(false);
  });

  it("closes every section too", () => {
    expect(Object.values(allSections(false)).every((v) => v === false)).toBe(true);
  });
});

describe("splitDeposits section", () => {
  it("opens on arrival, so who got what is on screen after dividing a line", () => {
    expect(SECTION_KEYS).toContain("splitDeposits");
    expect(SECTION_OPEN_BY_DEFAULT.splitDeposits).toBe(true);
  });
});
