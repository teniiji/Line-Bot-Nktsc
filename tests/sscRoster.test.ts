import { describe, expect, it } from "vitest";
import { classifySsc, firstNameOf, parseSscText, SscFileError } from "../lib/sscRoster";
import { computeCollateral, DEFAULT_RATES, type CoverageInput } from "../lib/coverage";

const HEADER = '"คำนำหน้า"\t"ชื่อ"\t"สกุล"\t"ทะเบียน สมาคม"\t"ทะเบียน สหกรณ์"\t"เลชบัตรประชาชน"\t"สถานะ"\t"วันที่ลาออก"\t"งวดส่งรายเดือน"\t"ยอดส่งรายเดือน"\t"ยอดคงเหลือ"\t';
const row = (cells: string[]) => cells.map((c) => `"${c}"`).join("\t") + "\t";
const FILE = [
  HEADER,
  row(["นาย", "คำแดง", "ผาทอง", "00000031  ", "00000000", "", "1", "26/01/2009 00:00:00", "000000", "0", "0"]),
  row(["นาง", "พรสถิต", "ชะโยจะ", "00000781  ", "00000511", "3430100000001  ", "0", "", "256911", "450", "0"]),
  // the member's mother, under the member's number
  row(["นาง", "ตุ้มทอง", "ชะโยจะ", "00000782  ", "00000511", "", "0", "", "256911", "450", "0"]),
  row(["นาง", "สมพร", "จันบง", "00000900  ", "00000000", "", "0", "", "000000", "0", "0"]),
  row(["นาย", "ใคร", "สักคน", "00000901  ", "00099999", "", "0", "", "256911", "450", "0"]),
  row(["นาง", "ธัชณันย์(สุรสสา)", "ชุณหธนกิตต์", "00000902  ", "00005492", "", "0", "", "000000", "0", "0"]),
].join("\r\n");

describe("parseSscText", () => {
  it("reads the tab-separated export, its status and payments", () => {
    const rows = parseSscText(FILE);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ memberNumber: null, active: false, lastPeriod: null, monthly: null });
    expect(rows[1]).toEqual({
      title: "นาง",
      firstName: "พรสถิต",
      lastName: "ชะโยจะ",
      assocNumber: "00000781",
      memberNumber: "511",
      active: true,
      lastPeriod: "256911",
      monthly: 450,
    });
  });

  it("refuses a file without the expected headings", () => {
    expect(() => parseSscText('"ชื่อ"\t"ที่อยู่"\r\n"ก"\t"ข"')).toThrow(SscFileError);
  });
});

describe("classifySsc", () => {
  it("keeps members' own current memberships and counts the rest", () => {
    const members = new Map([
      ["511", "นางพรสถิต ชะโยจะ"],
      ["5492", "นางธัชณันย์ ชุณหธนกิตติ์"],
    ]);
    const { own, counts } = classifySsc(parseSscText(FILE), members);
    expect(own.map((o) => o.memberNumber)).toEqual(["511", "5492"]);
    expect(counts).toEqual({ rows: 6, left: 1, relatives: 1, noMemberNumber: 1, notMember: 1, notPaying: 1 });
  });

  it("compares first names without title or bracketed former name", () => {
    expect(firstNameOf("ว่าที่ร้อยตรีหญิงภุมรินทร์ อินกกผึ้ง")).toBe("ภุมรินทร์");
    expect(firstNameOf("นางสาวอภิญญา  พิเภก")).toBe("อภิญญา");
  });
});

describe("collateral with สสค.", () => {
  const m: CoverageInput = {
    memberNumber: "1", memberName: null, unitName: null, gender: null, age: 50, sharePeriods: 0, shares: 0, debt: 0,
    insuredSum: 0, premium: 0, premiumDeducted: null, hasSok: true, hasScs: false, hasSst: false, hasSsk: false,
    relativeCount: 0, relativeFees: 0, debtStatus: null, undeducted: null,
  };
  it("adds its benefit for a member of it, and nothing without a list", () => {
    expect(computeCollateral({ ...m, hasSsc: true }, { ...DEFAULT_RATES, benefitSsc: 270000 })).toMatchObject({ cremation: 870000, associations: 2 });
    expect(computeCollateral({ ...m, hasSsc: true }, DEFAULT_RATES)).toMatchObject({ cremation: 600000 });
    expect(computeCollateral(m, { ...DEFAULT_RATES, benefitSsc: 270000 })).toMatchObject({ cremation: 600000, associations: 1 });
  });
});
