import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEFAULT_RATES, withCollateral, type CoverageInput } from "../lib/coverage";
import { buildShortfallWorkbook, shortfallFileName, shortfallRows } from "../lib/shortfallWorkbook";

const base: CoverageInput = {
  memberNumber: "",
  memberName: null,
  unitName: null,
  gender: null,
  age: null,
  sharePeriods: null,
  shares: 0,
  debt: 0,
  insuredSum: 0,
  premium: 0,
  premiumDeducted: null,
  hasSok: false,
  hasScs: false,
  hasSst: false,
  hasSsk: false,
  relativeCount: 0,
  relativeFees: 0,
  debtStatus: null,
  undeducted: null,
};

const row = (m: Partial<CoverageInput>) => withCollateral({ ...base, ...m }, DEFAULT_RATES);

const short1 = row({ memberNumber: "010175", memberName: "นายหนึ่ง ทดสอบ", unitName: "สพป.นค.1", age: 72, shares: 100000, debt: 1500000.5 });
const short2 = row({ memberNumber: "22495", memberName: "นางสอง ทดสอบ", unitName: "บำนาญ", age: 81, shares: 50000, debt: 300000 });
const enough = row({ memberNumber: "511", memberName: "นายพอ ทดสอบ", shares: 900000, debt: 100000 });

describe("shortfallRows", () => {
  it("keeps only members short of collateral, numbered in the given order", () => {
    const out = shortfallRows([short1, enough, short2]);
    expect(out.map((r) => [r.no, r.memberNumber])).toEqual([
      [1, "010175"],
      [2, "22495"],
    ]);
    expect(out[0].shortfall).toBe(-short1.margin);
    expect(out[0].shortfall).toBeGreaterThan(0);
  });
});

describe("buildShortfallWorkbook", () => {
  it("lays out the title, the headings, one row a member and the total", async () => {
    const asOf = new Date("2026-11-26T00:00:00+07:00");
    const buf = await buildShortfallWorkbook([short1, enough, short2], { asOf });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const s = wb.worksheets[0];

    expect(s.getCell("A1").value).toBe("รายชื่อสมาชิกสหกรณ์ออมทรัพย์ครูหนองคาย จำกัด");
    expect(s.getCell("A2").value).toBe("ที่หลักประกันไม่ครอบคลุมหนี้ ณ 26 พ.ย. 2569");
    expect(s.getRow(4).values).toEqual([undefined, "ที่", "เลขสมาชิก", "ชื่อ-สกุล", "หน่วยงาน", "อายุ", "หนี้", "หลักประกันไม่พอ"]);
    expect(s.getRow(5).values).toEqual([undefined, 1, "010175", "นายหนึ่ง ทดสอบ", "สพป.นค.1", 72, 1500000.5, -short1.margin]);
    expect(s.getRow(6).getCell(2).value).toBe("22495");
    expect(s.getCell("A7").value).toBe("รวม 2 คน");
    expect(s.getCell("F7").value).toBe(1800000.5);
    expect(s.getCell("G7").value).toBeCloseTo(-short1.margin - short2.margin, 2);
    expect(s.pageSetup.printTitlesRow).toBe("4:4");
  });

  it("names the file by the figures' date", () => {
    expect(shortfallFileName(new Date("2026-11-26T00:00:00+07:00"))).toBe("สมาชิกหลักประกันไม่พอ_26_พ.ย._2569.xlsx");
  });
});
