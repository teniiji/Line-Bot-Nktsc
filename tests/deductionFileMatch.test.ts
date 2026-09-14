import { describe, expect, it } from "vitest";
import { matchFileNameToUnit } from "../lib/deductionFileMatch";

const units = ["โรงเรียนบ้านโนนสวรรค์", "โรงเรียนบ้านหนองบัว", "สพป.นค เขต 1"];

describe("matchFileNameToUnit", () => {
  it("matches an exact filename regardless of extension/case", () => {
    expect(matchFileNameToUnit("โรงเรียนบ้านโนนสวรรค์.xlsx", units)).toBe(
      "โรงเรียนบ้านโนนสวรรค์"
    );
    expect(matchFileNameToUnit("โรงเรียนบ้านโนนสวรรค์.XLS", units)).toBe(
      "โรงเรียนบ้านโนนสวรรค์"
    );
  });

  it("matches when the unit name is a prefix/suffix of the file name", () => {
    expect(matchFileNameToUnit("รายการหัก_โรงเรียนบ้านหนองบัว_0969.xlsx", units)).toBe(
      "โรงเรียนบ้านหนองบัว"
    );
  });

  it("tolerates extra spaces/underscores/dashes", () => {
    expect(matchFileNameToUnit("สพป.นค  เขต-1.xlsx", units)).toBe("สพป.นค เขต 1");
  });

  it("refuses to guess when more than one unit could match", () => {
    const ambiguousUnits = ["โรงเรียนบ้านโคก", "โรงเรียนบ้านโคกใหญ่"];
    expect(matchFileNameToUnit("โรงเรียนบ้านโคกใหญ่_เดือนกันยายน.xlsx", ambiguousUnits)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchFileNameToUnit("ไฟล์ไม่เกี่ยวข้อง.xlsx", units)).toBeNull();
  });
});
