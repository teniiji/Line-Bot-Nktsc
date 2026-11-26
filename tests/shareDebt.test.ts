import { describe, expect, it } from "vitest";
import { applyShareReport, parseShareDebtSheet, ShareDebtSheetError } from "../lib/shareDebt";
import type { CoverageInput } from "../lib/coverage";

describe("parseShareDebtSheet", () => {
  it("reads a total debt column and the share balance, not the instalment count", () => {
    const sheet = parseShareDebtSheet([
      [
        ["รายงานหุ้นหนี้ ณ 31 ต.ค. 69"],
        ["เลขสมาชิก", "ชื่อ-สกุล", "งวดหุ้น", "หุ้นสะสม", "หนี้รวม"],
        ["31744", "นาย ก", 120, "350,000.50", 1200000],
        ["31744", "ซ้ำ", 1, 1, 1],
        ["4167", "นาง ข", "", 90000, ""],
        ["รวม", "", "", 440000, 1200000],
      ],
    ]);
    expect(sheet.debtColumns).toEqual(["หนี้รวม"]);
    expect(sheet.sharesColumn).toBe("หุ้นสะสม");
    expect(sheet.periodsColumn).toBe("งวดหุ้น");
    expect(sheet.duplicates).toBe(1);
    expect(sheet.entries).toEqual([
      { memberNumber: "31744", memberName: "นาย ก", shares: 350000.5, debt: 1200000, sharePeriods: 120 },
      { memberNumber: "4167", memberName: "นาง ข", shares: 90000, debt: 0, sharePeriods: null },
    ]);
  });

  it("adds up the loan balances when there is no total, leaving out payments and interest", () => {
    const sheet = parseShareDebtSheet([
      [
        ["ทะเบียนสมาชิก", "ชื่อ", "หุ้น", "เงินกู้สามัญคงเหลือ", "เงินกู้ฉุกเฉินคงเหลือ", "ส่งชำระสามัญ", "ดอกเบี้ยค้าง"],
        ["25686", "นาย ค", 10000, 500000, 20000, 9000, 300],
      ],
    ]);
    expect(sheet.debtColumns).toEqual(["เงินกู้สามัญคงเหลือ", "เงินกู้ฉุกเฉินคงเหลือ"]);
    expect(sheet.entries[0]).toMatchObject({ shares: 10000, debt: 520000 });
  });

  it("refuses a sheet without a member number and a share or debt column", () => {
    expect(() => parseShareDebtSheet([[["ชื่อ", "ที่อยู่"], ["ก", "ข"]]])).toThrow(ShareDebtSheetError);
  });
});

const member = (n: string, over: Partial<CoverageInput> = {}): CoverageInput => ({
  memberNumber: n,
  memberName: null,
  unitName: null,
  gender: null,
  age: 60,
  sharePeriods: 100,
  shares: 100000,
  debt: 500000,
  insuredSum: 1000000,
  premium: 9600,
  premiumDeducted: true,
  hasSok: true,
  hasScs: false,
  hasSst: false,
  hasSsk: false,
  relativeCount: 0,
  relativeFees: 0,
  debtStatus: null,
  undeducted: null,
  ...over,
});

describe("applyShareReport", () => {
  it("replaces shares, debt and instalments and keeps the file's figures beside them", () => {
    const [a, b, c] = applyShareReport(
      [member("1"), member("2", { debt: null, debtStatus: "ไม่มีในรายงานหุ้นหนี้" }), member("3")],
      new Map([
        ["1", { shares: 120000, debt: 300000, sharePeriods: 110 }],
        ["2", { shares: null, debt: 50000, sharePeriods: null }],
      ])
    );
    expect(a).toMatchObject({ shares: 120000, debt: 300000, sharePeriods: 110, fileShares: 100000, fileDebt: 500000, notInShareReport: false });
    // A report without a shares column leaves the file's shares.
    expect(b).toMatchObject({ shares: 100000, debt: 50000, sharePeriods: 100, debtStatus: null });
    expect(c).toMatchObject({ shares: 100000, debt: 500000, notInShareReport: true });
  });
});
