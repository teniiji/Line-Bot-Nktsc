import { describe, expect, it } from "vitest";
import { planAutoLinks, officeSuggestions, planOfficeSync, type UnitMemberRow } from "../lib/unitPayerOffices";

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
      { office: "อุดรธานี 1", overlap: 2, size: 2, matched: ["28864", "29766"] },
      { office: "อุดรธานี 4", overlap: 1, size: 1, matched: ["29395"] },
    ]);
  });

  it("leaves out offices already linked anywhere, and offices sharing nobody", () => {
    expect(officeSuggestions(["28864"], office, new Set(["อุดรธานี 1"]))).toEqual([]);
  });
});

describe("planAutoLinks", () => {
  const offices = [
    { memberNumber: "31132", office: "ศธจ.กาฬสินธุ์" },
    { memberNumber: "40001", office: "ศธจ.กาฬสินธุ์" },
    { memberNumber: "26659", office: "วิทยาลัยสารพัดช่างนครปฐม" },
    { memberNumber: "29375", office: "สพม.ปทุมธานี" },
    { memberNumber: "29376", office: "สพป.ปทุมธานี 2" },
  ];

  it("links each unit to the one office its members point at", () => {
    const plan = planAutoLinks(
      [
        { payerId: "kalasin", memberNumbers: ["31132"], linked: false },
        { payerId: "nakhonpathom", memberNumbers: ["026659"], linked: false },
      ],
      offices,
      new Set()
    );
    expect(plan.map((p) => `${p.payerId}=${p.office}`).sort()).toEqual([
      "kalasin=ศธจ.กาฬสินธุ์",
      "nakhonpathom=วิทยาลัยสารพัดช่างนครปฐม",
    ]);
  });

  it("leaves a unit whose members split evenly between offices, one already linked, or one with no member on the list", () => {
    const plan = planAutoLinks(
      [
        { payerId: "pathum", memberNumbers: ["29375", "29376"], linked: false },
        { payerId: "done", memberNumbers: ["31132"], linked: true },
        { payerId: "unknown", memberNumbers: ["99999"], linked: false },
      ],
      offices,
      new Set()
    );
    expect(plan).toEqual([]);
  });

  it("gives an office two units want to the one sharing more, and to neither on a tie", () => {
    const more = planAutoLinks(
      [
        { payerId: "a", memberNumbers: ["31132", "40001"], linked: false },
        { payerId: "b", memberNumbers: ["31132"], linked: false },
      ],
      offices,
      new Set()
    );
    expect(more.map((p) => p.payerId)).toEqual(["a"]);
    const tie = planAutoLinks(
      [
        { payerId: "a", memberNumbers: ["31132"], linked: false },
        { payerId: "b", memberNumbers: ["40001"], linked: false },
      ],
      offices,
      new Set()
    );
    expect(tie).toEqual([]);
  });

  it("never takes an office already linked elsewhere", () => {
    expect(planAutoLinks([{ payerId: "a", memberNumbers: ["31132"], linked: false }], offices, new Set(["ศธจ.กาฬสินธุ์"]))).toEqual([]);
  });
});
