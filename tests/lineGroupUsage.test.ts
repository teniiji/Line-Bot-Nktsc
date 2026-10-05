import { describe, expect, it } from "vitest";
import { GROUP_DEPARTMENTS, parseGroupUsage, planGroupUsage, usageRefusal } from "../lib/lineGroupUsage";

describe("parseGroupUsage", () => {
  it("trims, drops blanks and duplicates", () => {
    expect(parseGroupUsage({ departments: ["เงินฝาก", " เงินฝาก ", ""], units: ["สพป.นค เขต 1", "สพป.นค เขต 1"] })).toEqual({
      departments: ["เงินฝาก"],
      units: ["สพป.นค เขต 1"],
    });
  });

  it("refuses สินเชื่อ and names that are not departments", () => {
    expect(GROUP_DEPARTMENTS).not.toContain("สินเชื่อ");
    expect(parseGroupUsage({ departments: ["สินเชื่อ"], units: [] })).toHaveProperty("error");
    expect(parseGroupUsage({ departments: ["ไม่มีแผนกนี้"], units: [] })).toHaveProperty("error");
  });

  it("needs both lists", () => {
    expect(parseGroupUsage({ departments: ["เงินฝาก"] })).toHaveProperty("error");
    expect(parseGroupUsage(null)).toHaveProperty("error");
  });
});

describe("planGroupUsage", () => {
  it("adds and removes only the differences", () => {
    const plan = planGroupUsage(
      { departments: ["สารสนเทศ", "บัญชี"], units: ["ตจว1", "ตจว3"] },
      { departments: ["สารสนเทศ", "เงินฝาก"], units: ["ตจว3", "ศึกษาธิการเลย"] }
    );
    expect(plan).toEqual({
      addDepartments: ["เงินฝาก"],
      removeDepartments: ["บัญชี"],
      assignUnits: ["ศึกษาธิการเลย"],
      releaseUnits: ["ตจว1"],
    });
  });

  it("lets a group the bot left be emptied but not given anything", () => {
    const empty = planGroupUsage({ departments: ["สารสนเทศ"], units: ["ตจว1"] }, { departments: [], units: [] });
    expect(usageRefusal(empty, true)).toBeNull();
    const more = planGroupUsage({ departments: [], units: [] }, { departments: ["เงินฝาก"], units: [] });
    expect(usageRefusal(more, true)).toMatch(/บอทไม่อยู่/);
    expect(usageRefusal(more, false)).toBeNull();
  });
});
