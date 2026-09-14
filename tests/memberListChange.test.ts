import { describe, expect, it } from "vitest";
import {
  MemberListEntry,
  describeShrink,
  needsShrinkConfirmation,
  summarizeMemberListChange,
} from "../lib/memberListChange";

const roster = (count: number, unitName: string, from = 1): MemberListEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    memberNumber: String(from + i).padStart(5, "0"),
    unitName,
  }));

describe("summarizeMemberListChange", () => {
  it("counts what the new sheet drops and what it brings", () => {
    const existing = [...roster(3, "สพป.นค.1"), ...roster(2, "สพป.นค.2", 100)];
    const incoming = [...roster(3, "สพป.นค.1"), ...roster(4, "บำนาญ", 200)];

    const change = summarizeMemberListChange(existing, incoming);

    expect(change).toMatchObject({
      existingCount: 5,
      incomingCount: 7,
      removedCount: 2,
      removedUnits: ["สพป.นค.2"],
      addedUnits: ["บำนาญ"],
    });
  });

  it("identifies members by number, not by position or name", () => {
    // The same people with a corrected unit name is not two units changing.
    const existing = [{ memberNumber: "30051", unitName: "สพป.นค.1" }];
    const incoming = [{ memberNumber: "30051", unitName: "สพป. นค. 1" }];

    const change = summarizeMemberListChange(existing, incoming);
    expect(change.removedCount).toBe(0);
    expect(change.removedUnits).toEqual(["สพป.นค.1"]);
  });

  it("does not trip over members the sheet gave no unit for", () => {
    const change = summarizeMemberListChange(
      [{ memberNumber: "1", unitName: null }],
      [{ memberNumber: "1", unitName: null }]
    );
    expect(change.removedUnits).toEqual([]);
    expect(change.addedUnits).toEqual([]);
  });
});

describe("needsShrinkConfirmation", () => {
  it("asks when one unit's file is uploaded over the whole round", () => {
    // The mistake this exists for: 1,200 members replaced by one unit's 40.
    const existing = [
      ...roster(40, "สพป.นค.1"),
      ...roster(60, "สพป.นค.2", 1000),
      ...roster(50, "บำนาญ", 2000),
    ];
    const change = summarizeMemberListChange(existing, roster(40, "สพป.นค.1"));
    expect(needsShrinkConfirmation(change)).toBe(true);
  });

  it("does not ask about an ordinary correction", () => {
    // A re-run of the analysis moves a handful of people off the list; that
    // is the normal reason to re-upload and must stay one click.
    const existing = roster(100, "สพป.นค.1");
    const change = summarizeMemberListChange(existing, roster(94, "สพป.นค.1"));
    expect(needsShrinkConfirmation(change)).toBe(false);
  });

  it("does not ask when the list only grows", () => {
    const existing = roster(40, "สพป.นค.1");
    const incoming = [...existing, ...roster(30, "บำนาญ", 5000)];
    expect(needsShrinkConfirmation(summarizeMemberListChange(existing, incoming))).toBe(false);
  });

  it("does not ask on the first upload, when there is nothing to lose", () => {
    const change = summarizeMemberListChange([], roster(500, "สพป.นค.1"));
    expect(needsShrinkConfirmation(change)).toBe(false);
  });

  it("stays quiet on a round still being set up", () => {
    // Four rows going is not a day's work, and a round in its first minutes
    // changes shape constantly — asking there is noise that teaches staff to
    // click through the question that matters.
    const change = summarizeMemberListChange(roster(4, "สพป.นค.1"), []);
    expect(needsShrinkConfirmation(change)).toBe(false);
  });

  it("asks when the whole list would be wiped for a different one", () => {
    const change = summarizeMemberListChange(roster(20, "สพป.นค.1"), roster(20, "บำนาญ", 9000));
    expect(needsShrinkConfirmation(change)).toBe(true);
  });
});

describe("describeShrink", () => {
  const change = summarizeMemberListChange(
    [...roster(40, "สพป.นค.1"), ...roster(60, "สพป.นค.2", 1000)],
    roster(40, "สพป.นค.1")
  );

  it("gives the numbers that tell a redo from a wrong file", () => {
    const text = describeShrink(change);
    expect(text).toContain("100");
    expect(text).toContain("40");
    expect(text).toContain("60");
    expect(text).toContain("สพป.นค.2");
  });

  it("says what is lost that an upload cannot bring back", () => {
    // Members can be re-uploaded from the sheet; the account numbers staff
    // bound by hand cannot, so that is the part worth naming.
    expect(describeShrink(change)).toContain("เลขบัญชี");
  });

  it("does not list units when none disappear", () => {
    const grew = summarizeMemberListChange(roster(10, "สพป.นค.1"), roster(4, "สพป.นค.1"));
    expect(describeShrink(grew)).not.toContain("หายไปทั้งหน่วย");
  });
});
