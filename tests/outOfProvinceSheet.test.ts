import { describe, expect, it } from "vitest";
import {
  OutOfProvinceSheetError,
  dedupeByMember,
  findUnitConflicts,
  isTicked,
  parseOutOfProvinceSheet,
} from "../lib/outOfProvinceSheet";

// The checked file the dashboard hands back.
const CHECKED_HEADER = [
  "ยืนยัน",
  "สถานะ",
  "ชื่อในไฟล์",
  "หน่วยงานหักเงิน (ต่างจังหวัด)",
  "สังกัดเดิม",
  "เลขสมาชิก",
  "ชื่อในรายการหัก 0969",
  "หน่วยในรายการหัก 0969",
  "ยอดในไฟล์",
  "ยอดรายการหัก 0969",
  "หมายเหตุในไฟล์",
];

describe("parseOutOfProvinceSheet", () => {
  it("reads a checked file by heading and keeps only the ticked rows", () => {
    const sheet = parseOutOfProvinceSheet([
      CHECKED_HEADER,
      ["✓", "✅", "นายคมสันต์ ทาแท่งทอง", "อุดรธานี", "ต.1", 28864, "นายคมสันต์ ทาแท่งทอง", "750014 …", 14600, 14600, null],
      [null, "⚠️", "นางกุลธิดา เสนาสี", "สกลนคร 1", "ต.3", 26221, "นางสาวกุลธิดา สิงห์คำมา", "770001 …", null, null, null],
      [null, "❌", "นายสุพิจักข์ พร้อมจะบก", "นครสวรรค์", "ต.3", null, null, null, 31660, null, "NAKHONSAWANPR//เขต"],
    ]);
    expect(sheet.hasConfirmColumn).toBe(true);
    expect(sheet.unconfirmed).toBe(2);
    expect(sheet.problems).toEqual([]);
    expect(sheet.rows).toEqual([
      {
        memberNumber: "28864",
        memberName: "นายคมสันต์ ทาแท่งทอง",
        deductingUnit: "อุดรธานี",
        originalUnit: "ต.1",
        note: null,
        rowNumber: 2,
      },
    ]);
  });

  it("reads a plain list with no ยืนยัน column — every row with a number counts", () => {
    const sheet = parseOutOfProvinceSheet([
      ["ที่", "เลขสมาชิก", "ชื่อ - สกุล", "หน่วยงานหักเงิน", "สังกัดเดิม", "หมายเหตุ"],
      [1, "031132", "นางสาวอรอุมา ด้านกระโกะ", "สนง.เลขาธิการสภาการศึกษา", "ต.4", "Education Coun/สนง.เล"],
    ]);
    expect(sheet.hasConfirmColumn).toBe(false);
    expect(sheet.rows[0]).toMatchObject({
      memberNumber: "31132",
      deductingUnit: "สนง.เลขาธิการสภาการศึกษา",
      note: "Education Coun/สนง.เล",
    });
  });

  it("reports a ticked row that still has no usable member number", () => {
    const sheet = parseOutOfProvinceSheet([
      CHECKED_HEADER,
      ["✓", "❌", "นายสุพิจักข์ พร้อมจะบก", "นครสวรรค์", "ต.3", null],
      ["✓", "⚠️", "นางวีรญา บุตรจันทร์", "เทศบาลเมืองเลย", "ต.4", "24754x"],
      ["✓", "✅", "นายภูวิชัย บรรจง", "", "ต.4", 30258],
    ]);
    expect(sheet.rows).toEqual([]);
    expect(sheet.problems.map((p) => p.rowNumber)).toEqual([2, 3, 4]);
    expect(sheet.problems[0].reason).toMatch(/ไม่มีเลขสมาชิก/);
    expect(sheet.problems[1].reason).toMatch(/ไม่ใช่ตัวเลข/);
    expect(sheet.problems[2].reason).toMatch(/ไม่มีหน่วยงานหักเงิน/);
  });

  it("refuses a row still carrying more than one office, and evens out spacing", () => {
    const sheet = parseOutOfProvinceSheet([
      ["เลขสมาชิก", "หน่วยงานหักเงิน"],
      [29719, "ขอนแก่น 4 | สกลนคร 2"],
      [29940, "ชัยภูมิ1"],
    ]);
    expect(sheet.problems[0].reason).toMatch(/แก้ให้เหลือหน่วยงานเดียว/);
    expect(sheet.rows.map((r) => r.deductingUnit)).toEqual(["ชัยภูมิ 1"]);
  });

  it("finds a header below a title row and skips blank lines", () => {
    const sheet = parseOutOfProvinceSheet([
      ["รายชื่อสมาชิกย้ายไปต่างจังหวัด"],
      [],
      ["เลขสมาชิก", "หน่วยงานหักเงิน"],
      [null, null],
      [29375, "นราธิวาส 3"],
    ]);
    expect(sheet.blankRows).toBe(1);
    expect(sheet.rows.map((r) => r.memberNumber)).toEqual(["29375"]);
  });

  it("refuses a file without the two columns it needs", () => {
    expect(() => parseOutOfProvinceSheet([["ชื่อ", "หน่วยงานหักเงิน"], ["ก", "ข"]])).toThrow(
      OutOfProvinceSheetError
    );
  });
});

describe("isTicked", () => {
  it("accepts a check mark or a typed yes, not a blank or a status", () => {
    for (const v of ["✓", "✔", "Y", "yes", "1", "ใช่", " ✓ "]) expect(isTicked(v)).toBe(true);
    for (const v of [null, "", "✅ ตรงชื่อ", "no", 0]) expect(isTicked(v)).toBe(false);
  });
});

describe("conflicts and duplicates", () => {
  const row = (memberNumber: string, deductingUnit: string, rowNumber: number) => ({
    memberNumber,
    memberName: null,
    deductingUnit,
    originalUnit: null,
    note: null,
    rowNumber,
  });

  it("flags one member under two different offices", () => {
    expect(
      findUnitConflicts([row("28794", "อุดรธานี 4", 2), row("28794", "อุดรธานี 1", 3), row("1", "x", 4)])
    ).toEqual([{ memberNumber: "28794", units: ["อุดรธานี 4", "อุดรธานี 1"] }]);
  });

  it("keeps a member listed twice for the same office once", () => {
    const rows = [row("28794", "อุดรธานี 4", 2), row("28794", "อุดรธานี 4", 9)];
    expect(findUnitConflicts(rows)).toEqual([]);
    expect(dedupeByMember(rows).map((r) => r.rowNumber)).toEqual([2]);
  });
});
