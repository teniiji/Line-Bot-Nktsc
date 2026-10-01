import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { deductionFileTotal } from "../lib/deductionFileTotal";
import { readFirstSheetRows } from "../lib/excelUpload";

describe("deductionFileTotal", () => {
  it("adds the cooperative's column of a เขต file, not the combined รวม or the สสค beside it", () => {
    const rows = [
      ["รายการหักเงิน สหกรณ์ออมทรัพย์ครูหนองคาย ประจำเดือน ตุลาคม 2569"],
      ["ลำดับ", "เลขที่", "ชื่อ-สกุล", "สหกรณ์", "สสค", "รวม"],
      [1, "023321", "นางสาวอ่อนจิต ยางงาม", 7400, 600, 8000],
      [2, "27591", "นางสุปัญญา ประทาน", 3200, 0, 3200],
      // The unit's own foot line — never a member, never counted again.
      ["", "รวม", "", 10600, 600, 11200],
    ];
    expect(deductionFileTotal(rows)).toEqual({ amount: 10600, memberCount: 2, column: "สหกรณ์" });
  });

  it("falls back to a จำนวนเงิน heading, and counts a member with two lines once", () => {
    const rows = [
      ["เลขสมาชิก", "ชื่อ", "จำนวนเงิน"],
      ["11111", "ก", "1,500.50"],
      ["11111", "ก", 499.5],
      ["22222", "ข", 3000],
    ];
    expect(deductionFileTotal(rows)).toEqual({ amount: 5000, memberCount: 2, column: "จำนวนเงิน" });
  });

  it("still counts the members of a file with no amount column", () => {
    const rows = [
      ["เลขสมาชิก", "ชื่อ-สกุล"],
      ["11111", "ก"],
      ["22222", "ข"],
    ];
    expect(deductionFileTotal(rows)).toEqual({ amount: null, memberCount: 2, column: null });
  });

  it("gives up on a sheet with no members in it", () => {
    expect(deductionFileTotal([["สรุปยอด"], ["รวม", 1000]])).toBeNull();
  });
});

describe("deductionFileTotal on a real workbook", () => {
  it("reads the total through the same reader the upload uses, formulas included", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("รายการหัก");
    sheet.addRow(["รายการหักเงินประจำเดือน ตุลาคม 2569"]);
    sheet.addRow(["เลขที่", "ชื่อ-สกุล", "สหกรณ์"]);
    sheet.addRow(["023321", "นางสาวอ่อนจิต ยางงาม", 7400]);
    sheet.addRow(["27591", "นางสุปัญญา ประทาน", 3200.25]);
    // The foot total, as a formula with its cached result.
    sheet.addRow(["รวม", "", { formula: "SUM(C3:C4)", result: 10600.25 }]);
    const bytes = await workbook.xlsx.writeBuffer();
    const rows = await readFirstSheetRows(new File([bytes], "เขต1.xlsx"));
    expect(deductionFileTotal(rows)).toEqual({ amount: 10600.25, memberCount: 2, column: "สหกรณ์" });
  });
});
