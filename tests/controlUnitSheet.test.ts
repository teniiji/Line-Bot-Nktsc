import { describe, expect, it } from "vitest";
import { controlUnitCode, readControlUnitSheet } from "../lib/controlUnitSheet";

describe("readControlUnitSheet", () => {
  it("reads the list as the cooperative writes it", () => {
    const read = readControlUnitSheet([
      [100, "วิทยาลัยเทคนิคหนองคาย"],
      [1, "อำเภอเมือง"],
      [1300, "วิทยาลัยการอาชีพเซกา"],
    ]);
    expect(read.rows).toEqual([
      { code: "100", name: "วิทยาลัยเทคนิคหนองคาย" },
      { code: "1", name: "อำเภอเมือง" },
      { code: "1300", name: "วิทยาลัยการอาชีพเซกา" },
    ]);
    expect(read.skipped).toBe(0);
  });

  it("steps over a heading row without taking it for a unit", () => {
    const read = readControlUnitSheet([
      ["รหัส", "ชื่อหน่วยคุม"],
      [1, "อำเภอเมือง"],
    ]);
    expect(read.rows).toEqual([{ code: "1", name: "อำเภอเมือง" }]);
    expect(read.skipped).toBe(1);
  });

  it("squeezes the double spaces the supplied file is written with", () => {
    // "ร.ร.จ่ายตรง  ร.ร.ท่าบ่อ" — the same unit typed again by hand would
    // not match it otherwise.
    const read = readControlUnitSheet([[40, "ร.ร.จ่ายตรง  ร.ร.ท่าบ่อ"]]);
    expect(read.rows[0].name).toBe("ร.ร.จ่ายตรง ร.ร.ท่าบ่อ");
  });

  it("counts a row it cannot read rather than dropping it silently", () => {
    const read = readControlUnitSheet([
      [1, "อำเภอเมือง"],
      ["รวมทั้งสิ้น", 92],
      [2, ""],
      [null, null],
    ]);
    expect(read.rows).toHaveLength(1);
    expect(read.skipped).toBe(2);
  });

  it("keeps the last word on a code named twice", () => {
    const read = readControlUnitSheet([
      [1, "ชื่อเก่า"],
      [1, "อำเภอเมือง"],
    ]);
    expect(read.rows).toEqual([{ code: "1", name: "อำเภอเมือง" }]);
  });
});

describe("controlUnitCode", () => {
  it("drops leading zeros, which would split one unit into two", () => {
    expect(controlUnitCode("01")).toBe("1");
    expect(controlUnitCode(" 052 ")).toBe("52");
  });

  it("refuses anything that is not a number", () => {
    expect(controlUnitCode("หน่วยคุม 1")).toBeNull();
    expect(controlUnitCode("1A")).toBeNull();
    expect(controlUnitCode("")).toBeNull();
    expect(controlUnitCode("0")).toBeNull();
  });
});
