import { describe, expect, it } from "vitest";
import {
  aliasKey,
  filesForPeriod,
  isDeductionWorkbook,
  keysToRemember,
  matchFileNameToUnit,
  matchFolderFile,
} from "../lib/deductionFileMatch";

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


describe("aliasKey", () => {
  it("drops the month and year but keeps a เขต number", () => {
    expect(aliasKey("รายการหัก สพป นค เขต 2 เดือน สิงหาคม 2569.xlsx")).toBe(
      aliasKey("รายการหัก สพป นค เขต 2 เดือน กันยายน 2569.xlsx")
    );
    expect(aliasKey("รายการหัก สพป นค เขต 2 0969.xlsx")).not.toBe(aliasKey("รายการหัก สพป นค เขต 1 0969.xlsx"));
  });
});

describe("folder uploads", () => {
  const unitNames = ["สพป.นค เขต 1", "สพป.นค เขต 2", "อบต.พระบาทนาสิงห์", "ตจว1"];

  it("keeps only this round's month folder when there is one", () => {
    const files = [
      { path: "รายการหัก/ตจว1/0869/a.xlsx" },
      { path: "รายการหัก/ตจว1/0969/a.xlsx" },
      { path: "รายการหัก/สพป.นค เขต 1/0969/b.xlsx" },
    ];
    expect(filesForPeriod(files, "0969").map((f) => f.path)).toEqual([
      "รายการหัก/ตจว1/0969/a.xlsx",
      "รายการหัก/สพป.นค เขต 1/0969/b.xlsx",
    ]);
    // No month folders at all: everything chosen is this month's.
    expect(filesForPeriod([{ path: "x.xlsx" }], "0969")).toHaveLength(1);
  });

  it("skips Excel's lock files and anything that is not a workbook", () => {
    expect(isDeductionWorkbook("ตจว1.xlsx")).toBe(true);
    expect(isDeductionWorkbook("~$ตจว1.xlsx")).toBe(false);
    expect(isDeductionWorkbook("หนังสือนำส่ง.pdf")).toBe(false);
  });

  it("names the unit by its folder when the file name does not", () => {
    const match = matchFolderFile("รายการหัก/อบต.พระบาทนาสิงห์/0969/รายการหัก 0969.xlsx", unitNames, new Map());
    expect(match).toMatchObject({ unitName: "อบต.พระบาทนาสิงห์", via: "folder" });
  });

  it("prefers the file name to the folder, and a remembered choice to both", () => {
    expect(matchFolderFile("ตจว1/0969/สพป.นค เขต 2.xlsx", unitNames, new Map()).unitName).toBe("สพป.นค เขต 2");
    const remembered = new Map([[aliasKey("ไฟล์จากคุณสมศรี"), "ตจว1"]]);
    expect(matchFolderFile("ไฟล์จากคุณสมศรี/0969/อะไรก็ได้.xlsx", unitNames, remembered)).toMatchObject({
      unitName: "ตจว1",
      via: "remembered",
    });
  });

  it("ignores a remembered unit that is not in this round", () => {
    const remembered = new Map([[aliasKey("เก่า"), "หน่วยที่ยุบไปแล้ว"]]);
    expect(matchFolderFile("เก่า/0969/x.xlsx", unitNames, remembered).unitName).toBeNull();
  });

  it("remembers only names that point at one unit", () => {
    const rows = [
      { unitName: "ตจว1", keys: ["รายการหัก ตจว1", "ตจว1"] },
      { unitName: "สพป.นค เขต 1", keys: ["รายการหัก", "สพป.นค เขต 1"] },
      // The same file name for two units says nothing about either.
      { unitName: "สพป.นค เขต 2", keys: ["ไฟล์หน่วยงาน", "เขต 2 นค"] },
      { unitName: "อบต.พระบาทนาสิงห์", keys: ["ไฟล์หน่วยงาน", "อบต พระบาท"] },
      // A name an unmatched file also carries is not safe to remember.
      { unitName: null, keys: ["อบต พระบาท"] },
    ];
    const keys = keysToRemember(rows).map((r) => `${r.key}=${r.unitName}`).sort();
    expect(keys).toEqual(
      ["รายการหัก ตจว1=ตจว1", "ตจว1=ตจว1", "สพป.นค เขต 1=สพป.นค เขต 1", "เขต 2 นค=สพป.นค เขต 2"].sort()
    );
  });
});
