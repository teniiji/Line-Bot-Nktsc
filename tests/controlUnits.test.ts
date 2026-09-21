import { describe, expect, it } from "vitest";
import { CONTROL_UNIT_NAMES, controlUnitLabel, controlUnitName } from "../lib/controlUnits";

describe("the cooperative's หน่วยคุม list", () => {
  it("carries the codes the files and the summaries use", () => {
    // Spot-checked against the list the cooperative supplied: the two ends
    // of the numbering and a few in between that appear in every round.
    expect(controlUnitName("1")).toBe("อำเภอเมือง");
    expect(controlUnitName("52")).toBe("บำนาญ บึงกาฬ");
    expect(controlUnitName("75")).toBe("สมาชิกปกติย้ายไปต่างจังหวัด เขต 1");
    expect(controlUnitName("100")).toBe("วิทยาลัยเทคนิคหนองคาย");
    expect(controlUnitName("1300")).toBe("วิทยาลัยการอาชีพเซกา");
  });

  it("shows the code in front, because that is what the files are keyed on", () => {
    expect(controlUnitLabel("1")).toBe("1 อำเภอเมือง");
  });

  it("does not hide a code the list has not got", () => {
    // A unit added after this was written must still be pickable, or the
    // members in it become unreachable from the filter.
    expect(controlUnitName("9999")).toBeNull();
    expect(controlUnitLabel("9999")).toBe("หน่วยคุม 9999");
  });

  it("has no blank names and no repeated codes", () => {
    const entries = Object.entries(CONTROL_UNIT_NAMES);
    expect(entries.length).toBe(92);
    expect(entries.every(([, name]) => name.trim().length > 0)).toBe(true);
    expect(new Set(entries.map(([code]) => code)).size).toBe(entries.length);
  });

  it("keeps the codes as the digits they are written with", () => {
    // "01" and "1" would be two units in a dropdown and one in the data.
    expect(Object.keys(CONTROL_UNIT_NAMES).every((code) => /^[1-9][0-9]*$/.test(code))).toBe(true);
  });
});
