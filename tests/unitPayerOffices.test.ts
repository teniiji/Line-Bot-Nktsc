import { describe, expect, it } from "vitest";
import { officeSuggestions, planOfficeSync, type UnitMemberRow } from "../lib/unitPayerOffices";

const um = (over: Partial<UnitMemberRow> & { id: string; memberNumber: string }): UnitMemberRow => ({
  payerId: "udon",
  viaOffice: null,
  lastAmount: null,
  ...over,
});

describe("planOfficeSync", () => {
  const office = [
    { memberNumber: "28864", office: "อุดรธานี 1" },
    { memberNumber: "29766", office: "อุดรธานี 1" },
    { memberNumber: "28794", office: "อุดรธานี 4" },
  ];

  it("adds every member of a linked office the unit does not have yet", () => {
    const plan = planOfficeSync([{ payerId: "udon", office: "อุดรธานี 1" }], office, [
      um({ id: "m1", memberNumber: "28864", lastAmount: 14600 }),
    ]);
    expect(plan.add).toEqual([{ payerId: "udon", memberNumber: "29766", viaOffice: "อุดรธานี 1" }]);
    expect(plan.remove).toEqual([]);
  });

  it("takes back what a link brought once the link is gone", () => {
    const plan = planOfficeSync([], office, [
      um({ id: "m1", memberNumber: "28864", viaOffice: "อุดรธานี 1" }),
      um({ id: "m2", memberNumber: "29766", viaOffice: "อุดรธานี 1" }),
    ]);
    expect(plan.remove).toEqual(["m1", "m2"]);
  });

  it("never takes back a member staff recorded or gave an amount", () => {
    const plan = planOfficeSync([], office, [
      um({ id: "m1", memberNumber: "28864", viaOffice: "อุดรธานี 1", lastAmount: 14600 }),
      um({ id: "m2", memberNumber: "99999" }),
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("moves a member whose office changed in the list", () => {
    const plan = planOfficeSync(
      [
        { payerId: "udon", office: "อุดรธานี 1" },
        { payerId: "udon4", office: "อุดรธานี 4" },
      ],
      [{ memberNumber: "28864", office: "อุดรธานี 4" }],
      [um({ id: "m1", memberNumber: "28864", viaOffice: "อุดรธานี 1" })]
    );
    expect(plan.remove).toEqual(["m1"]);
    expect(plan.add).toEqual([{ payerId: "udon4", memberNumber: "28864", viaOffice: "อุดรธานี 4" }]);
  });

  it("takes back a member dropped from the list", () => {
    const plan = planOfficeSync([{ payerId: "udon", office: "อุดรธานี 1" }], [], [
      um({ id: "m1", memberNumber: "28864", viaOffice: "อุดรธานี 1" }),
    ]);
    expect(plan.remove).toEqual(["m1"]);
  });

  it("lets two spellings of one office share a unit without adding anyone twice", () => {
    const plan = planOfficeSync(
      [
        { payerId: "m-udon", office: "มัธยมอุดรธานี" },
        { payerId: "m-udon", office: "มัธยมศึกษาอุดรธานี" },
      ],
      [
        { memberNumber: "30471", office: "มัธยมอุดรธานี" },
        { memberNumber: "28868", office: "มัธยมศึกษาอุดรธานี" },
      ],
      []
    );
    expect(plan.add.map((a) => a.memberNumber).sort()).toEqual(["28868", "30471"]);
  });

  it("is a no-op when everything is already in place", () => {
    const plan = planOfficeSync([{ payerId: "udon", office: "อุดรธานี 1" }], office.slice(0, 2), [
      um({ id: "m1", memberNumber: "28864", viaOffice: "อุดรธานี 1" }),
      um({ id: "m2", memberNumber: "029766" }),
    ]);
    expect(plan).toEqual({ add: [], remove: [] });
  });
});

describe("officeSuggestions", () => {
  const office = [
    { memberNumber: "28864", office: "อุดรธานี 1" },
    { memberNumber: "29766", office: "อุดรธานี 1" },
    { memberNumber: "29395", office: "อุดรธานี 4" },
    { memberNumber: "31000", office: "อุดรธานี 3" },
  ];

  it("ranks offices by how many of the unit's own members they hold", () => {
    expect(officeSuggestions(["28864", "29766", "29395"], office, new Set())).toEqual([
      { office: "อุดรธานี 1", overlap: 2, size: 2 },
      { office: "อุดรธานี 4", overlap: 1, size: 1 },
    ]);
  });

  it("leaves out offices already linked anywhere, and offices sharing nobody", () => {
    expect(officeSuggestions(["28864"], office, new Set(["อุดรธานี 1"]))).toEqual([]);
  });
});
