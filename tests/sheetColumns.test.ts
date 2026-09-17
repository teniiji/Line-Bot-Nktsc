import { describe, expect, it } from "vitest";
import { columnSamples, detectSheetColumns, findHeaderRow } from "../lib/sheetColumns";
import { readMappedSheet } from "../lib/mappedSheet";

// The two shapes that arrived on the same day, reduced to a few rows each.

// A เขต's result file: two banner rows, a header, and a ลำดับ column in front
// of the member number. Reading this by fixed position put the ลำดับ in the
// member number and ยอดหักได้ in ยอดหักไม่ได้.
const unitFile: unknown[][] = [
  ["สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด", "สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด", "สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด"],
  ["รายการหักไม่ได้ บำนาญ บึงกาฬ", "รายการหักไม่ได้ บำนาญ บึงกาฬ", "รายการหักไม่ได้ บำนาญ บึงกาฬ"],
  ["ลำดับ", "เลขที่", "ชื่อ  สกุล", "แจ้งหัก", "หักได้", "หักไม่ได้", "รหัสหน่วย", "สังกัด"],
  [217, 1496, "บุญเลิศ สุวรรณไตร", 200, 200, 0, "520001", "บำนาญ บึงกาฬ อ.พรเจริญ"],
  [218, 2470, "วิเชียร ศรีสวาสดิ์", 11700, 11700, 0, "520001", "บำนาญ บึงกาฬ อ.พรเจริญ"],
  [219, 26772, "กัลยาณี สมภักดี", 22200, 14000, 8200, "520009", "บำนาญ บึงกาฬ อ.ปากคาด"],
  ["", "", "รวม", 34100, 25900, 8200, "", ""],
];

// The whole cooperative's รายการหัก: no header row at all, the national ID
// where an account number would look right, and leftover MATCH formulas.
const masterFile: unknown[][] = [
  [15885, "นายลิขิต ลำไธสง", 10582.75, 100, "วิทยาลัยเทคนิคหนองคาย", 3310200306695, 100,
    { formula: "MATCH(A1,J:J,0)", result: { error: "#N/A" } }],
  [19546, "นายสมคิด ลาแสง", 21165.25, 100, "วิทยาลัยเทคนิคหนองคาย", 3410100922202, 100,
    { formula: "MATCH(A2,J:J,0)", result: { error: "#N/A" } }],
  [19609, "นายภาคภูมิ กลั่นไพรี", 7078.25, 100, "วิทยาลัยเทคนิคหนองคาย", 3419900039107, 100,
    { formula: "MATCH(A3,J:J,0)", result: { error: "#N/A" } }],
  [23333, "นางสาวพัฒนา สุมาลี", 18400, 100, "วิทยาลัยเทคนิคหนองคาย", 3451400032661, 100, null],
  [23693, "นางพิสมัย วีย์รยาพร", 35860, 100, "วิทยาลัยเทคนิคหนองคาย", 3410700053302, 100, null],
];

describe("findHeaderRow", () => {
  it("steps over banner rows to the row that names the columns", () => {
    expect(findHeaderRow(unitFile)).toBe(2);
  });

  it("says so when there is no header", () => {
    expect(findHeaderRow(masterFile)).toBeNull();
  });
});

describe("detectSheetColumns", () => {
  it("reads a header row, ignoring the ลำดับ in front of the member number", () => {
    const reading = detectSheetColumns(unitFile);
    expect(reading.fromHeader).toBe(true);
    expect(reading.firstDataRow).toBe(3);
    expect(reading.mapping).toMatchObject({
      memberNumber: 1,
      name: 2,
      expected: 3,
      collected: 4,
      uncollected: 5,
      hCode: 6,
      unitName: 7,
    });
  });

  it("does not let หักได้ take the ยอดหักไม่ได้ column", () => {
    // "หักได้" is a substring of "หักไม่ได้" — the expensive confusion, worth
    // a test of its own: this is the mistake that imported a district that
    // had paid in full as owing ฿12,243,006.
    const reading = detectSheetColumns(unitFile);
    expect(reading.mapping.collected).toBe(4);
    expect(reading.mapping.uncollected).toBe(5);
  });

  it("finds member number, name and สังกัด in a sheet with no header", () => {
    const reading = detectSheetColumns(masterFile);
    expect(reading.fromHeader).toBe(false);
    expect(reading.firstDataRow).toBe(0);
    expect(reading.mapping).toMatchObject({ memberNumber: 0, name: 1, unitName: 4 });
  });

  it("never offers the national ID as an account number", () => {
    // Thirteen digits is exactly what an account-number detector would like,
    // and it is the one column this system deliberately does not store.
    const reading = detectSheetColumns(masterFile);
    expect(reading.mapping.accountNumber).toBeUndefined();
  });

  it("leaves the money columns unmapped when there is no header to name them", () => {
    // แจ้งหัก, หักได้ and หักไม่ได้ look identical to a detector, so guessing
    // is refused and the person picks.
    const reading = detectSheetColumns(masterFile);
    expect(reading.mapping.expected).toBeUndefined();
    expect(reading.mapping.collected).toBeUndefined();
    expect(reading.mapping.uncollected).toBeUndefined();
  });
});

describe("readMappedSheet", () => {
  it("reads the unit file the way its header says", () => {
    const reading = detectSheetColumns(unitFile);
    const read = readMappedSheet(unitFile, reading.firstDataRow, reading.mapping);

    expect(read.rows.map((r) => [r.memberNumber, r.result, r.amountDue])).toEqual([
      ["1496", "collected", 0],
      ["2470", "collected", 0],
      ["26772", "uncollected", 8200],
    ]);
    expect(read.rows[2]).toMatchObject({
      name: "กัลยาณี สมภักดี",
      expectedAmount: 22200,
      unitName: "บำนาญ บึงกาฬ อ.ปากคาด",
      hCode: "520009",
    });
  });

  it("counts the รวม line at the foot rather than importing it", () => {
    const reading = detectSheetColumns(unitFile);
    expect(readMappedSheet(unitFile, reading.firstDataRow, reading.mapping).skipped).toBe(1);
  });

  it("leaves every row of a รายการหัก awaiting its result", () => {
    // No result columns at all is not a fault — it is the list on its way
    // out, before anybody has answered for it.
    const reading = detectSheetColumns(masterFile);
    const read = readMappedSheet(masterFile, reading.firstDataRow, reading.mapping);
    expect(read.rows).toHaveLength(5);
    expect(read.awaiting).toBe(5);
    expect(read.rows.every((r) => r.amountDue === 0)).toBe(true);
  });

  it("takes the ยอดแจ้งหัก once somebody points at the column", () => {
    const reading = detectSheetColumns(masterFile);
    const read = readMappedSheet(masterFile, reading.firstDataRow, {
      ...reading.mapping,
      expected: 2,
    });
    expect(read.rows[0].expectedAmount).toBe(10582.75);
  });
});

describe("columnSamples", () => {
  it("shows each column's letter, heading and first values, for checking", () => {
    const reading = detectSheetColumns(unitFile);
    const samples = columnSamples(unitFile, reading);
    expect(samples[1]).toMatchObject({ letter: "B", header: "เลขที่" });
    expect(samples[1].samples[0]).toBe("1496");
  });
});
