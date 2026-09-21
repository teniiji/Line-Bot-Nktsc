import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { listSheets, readFirstSheetRows } from "../lib/excelUpload";

// A unit's sheet as they really arrive: the ยอดหักไม่ได้ column is not typed
// in, it is computed — "=F4-G4" written once and filled down the column,
// which Excel stores as a shared formula. Cells like that can reach us with
// no cached value at all, and reading them as "nothing" turned a member who
// was short ฿7,250 into a member who owed nothing.
const unitFile = async (): Promise<File> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ไม่ได้");
  ws.addRow(["สหกรณ์ออมทรัพย์ครูหนองคาย-บึงกาฬ จำกัด"]);
  ws.addRow(["รายการหัก สพป. เขต 3 เดือน กันยายน 2569"]);
  ws.addRow(["ลำดับที่", "เลขที่", "ชื่อ  -  สกุล", "สหกรณ์", "สสค.", "รวม", "หักได้", "หักไม่ได้"]);
  ws.addRow([1, 28590, "นายเสกสิน ศรีปากดี", 31600, 420, 32020, 24770]);
  ws.addRow([2, 30231, "นางสาวชนิสรา อุทโท", 5100, 0, 5100, 5100]);
  ws.addRow([3, 27406, "นายกิตติภพ ไกยเดช", 34360, 420, 34780, 32910]);
  // Written without a result, which is exactly how they arrive.
  ws.getCell("H4").value = { formula: "F4-G4" } as ExcelJS.CellFormulaValue;
  ws.getCell("H5").value = { formula: "F5-G5" } as ExcelJS.CellFormulaValue;
  ws.getCell("H6").value = { formula: "F6-G6" } as ExcelJS.CellFormulaValue;

  const summary = wb.addWorksheet("สรุป");
  summary.addRow(["รวมทั้งสิ้น", 15250]);

  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], "raikan.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
};

describe("readFirstSheetRows", () => {
  it("works out a formula the file left without a value", async () => {
    const rows = await readFirstSheetRows(await unitFile());
    // Header on row 3 (index 2), so the members start at index 3.
    expect(rows[3][7]).toBe(32020 - 24770);
    expect(rows[4][7]).toBe(0);
    expect(rows[5][7]).toBe(34780 - 32910);
  });

  it("reads the plain cells beside it unchanged", async () => {
    const rows = await readFirstSheetRows(await unitFile());
    expect(rows[3].slice(0, 7)).toEqual([
      1,
      28590,
      "นายเสกสิน ศรีปากดี",
      31600,
      420,
      32020,
      24770,
    ]);
  });

  it("reads the sheet it is asked for, not always the first", async () => {
    const file = await unitFile();
    expect(await listSheets(file)).toEqual([
      { index: 0, name: "ไม่ได้", rows: 6 },
      { index: 1, name: "สรุป", rows: 1 },
    ]);
    const second = await readFirstSheetRows(file, 1);
    expect(second[0][0]).toBe("รวมทั้งสิ้น");
  });
});
