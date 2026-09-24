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

// A เขต that collects for more than one organisation on the same line: its
// own column, the สสค.'s, and a รวม of the two. Payroll deducts the สสค.
// first, so a shortfall in the รวม is the cooperative's to chase — but the
// ยอดแจ้งหัก is the สหกรณ์ column alone, never the รวม.
const sharedCollectionFile: unknown[][] = [
  ["สหกรณ์ออมทรัพย์ครูหนองคาย-บึงกาฬ จำกัด"],
  ["รายการหัก สพป.กาฬสินธุ์ เขต 3 เดือน กันยายน 2569"],
  ["ลำดับที่", "เลขที่", "ชื่อ - สกุล", "สหกรณ์", "สสค.", "รวม", "หักได้", "หักไม่ได้"],
  [1, 28590, "เสกสิน ศรีปากดี", 31600, 420, 32020, 24770, 7250],
  [2, 30231, "ชนิสรา อุทโท", 5100, 0, 5100, 5100, 0],
  [3, 29222, "ธีรภัทร ภูนาเพชร", 27000, 420, 27420, 21290, 6130],
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
      // Headed "รหัสหน่วย", but 520001 is six digits and no หน่วยคุม the
      // cooperative has runs past 1200 — so it is the สังกัด's code.
      unitCode: 6,
      unitName: 7,
    });
    expect(reading.mapping.hCode).toBeUndefined();
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

describe("detectSheetColumns, where a sheet carries another body's money", () => {
  it("takes the สหกรณ์ column as ยอดแจ้งหัก, not the รวม", () => {
    const reading = detectSheetColumns(sharedCollectionFile);
    expect(reading.mapping.expected).toBe(3);
  });

  it("never maps the สสค. column to anything", () => {
    // Another organisation's money on the same line. Imported as a สหกรณ์
    // figure it would overstate every member's debt by their สสค. premium.
    const reading = detectSheetColumns(sharedCollectionFile);
    expect(Object.values(reading.mapping)).not.toContain(4);
  });

  it("still reads a รวม when it is the only total on the sheet", () => {
    const [banner, title, header, ...rows] = sharedCollectionFile;
    const noOwnColumn = [
      banner,
      title,
      header.filter((_, index) => index !== 3 && index !== 4),
      ...rows.map((row) => row.filter((_, index) => index !== 3 && index !== 4)),
    ];
    const reading = detectSheetColumns(noOwnColumn);
    expect(reading.mapping.expected).toBe(3);
    expect(header[5]).toBe("รวม");
  });

  it("keeps the whole shortfall, without subtracting the other body's share", () => {
    // Payroll takes the สสค. premium first, so what is missing from the รวม
    // is missing from the สหกรณ์'s share — ฿7,250 of a ฿31,600 deduction, not
    // ฿7,250 less ฿420. Confirmed with the cooperative before it was written.
    const reading = detectSheetColumns(sharedCollectionFile);
    const read = readMappedSheet(sharedCollectionFile, reading.firstDataRow, reading.mapping);
    expect(read.rows.map((r) => [r.memberNumber, r.result, r.amountDue, r.expectedAmount])).toEqual([
      ["28590", "uncollected", 7250, 31600],
      ["30231", "collected", 0, 5100],
      ["29222", "uncollected", 6130, 27000],
    ]);
    expect(read.uncollected).toBe(2);
  });
});

describe("detectSheetColumns, หน่วยคุม และสังกัด", () => {
  // The ไฟล์รวม's own shape: no header row at all, and three columns for
  // where a member sits — D รหัสสังกัด, E ชื่อสังกัด, G หน่วยคุม. The
  // หน่วยคุม is the coarse one the cooperative's สรุปหน่วยคุม counts by (64
  // over 7,000 rows, against 656 สังกัด).
  const masterRows = (): unknown[][] => {
    const units: [string, number, number][] = [
      ["ตจว.1 หักผ่านธนาคารกรุงไทย", 7501, 75],
      ["สมาชิกปกติย้ายไปต่างจังหวัด เขต 1 อ.เมือง", 7502, 75],
      ["สมาชิกปกติย้ายไปต่างจังหวัด เขต 1 อ.ท่าบ่อ", 7503, 75],
      ["วิทยาลัยเทคนิคหนองคาย", 100, 100],
      ["บำนาญ วิทยาลัยเทคนิคหนองคาย", 108, 100],
    ];
    return Array.from({ length: 60 }, (_, i) => {
      const [unit, unitCode, hCode] = units[i % units.length];
      // Member numbers have gaps — a column that counts up by one is the
      // ลำดับ, which the detector rules out on purpose.
      return [20000 + i * 17, `นายสมาชิก ที่ ${i}`, 1000 + i * 13, unitCode, unit, hCode];
    });
  };

  it("reads the three of them apart, coarsest as the หน่วยคุม", () => {
    const reading = detectSheetColumns(masterRows());
    expect(reading.fromHeader).toBe(false);
    expect(reading.mapping).toMatchObject({
      memberNumber: 0,
      name: 1,
      unitCode: 3,
      unitName: 4,
      hCode: 5,
    });
  });

  it("claims no สังกัด code where the file writes the หน่วยคุม twice", () => {
    // 0869 carries it in both F and J. A duplicate is not a finer grouping,
    // and reading it as one would invent a สังกัด the file never named.
    const twice = masterRows().map((row) => [...row.slice(0, 3), row[5], row[4], row[5]]);
    const reading = detectSheetColumns(twice);
    expect(reading.mapping.hCode).toBe(3);
    expect(reading.mapping.unitCode).toBeUndefined();
  });

  it("claims no codes at all on a sheet too short for repetition to mean anything", () => {
    // A unit's own file of six members has columns of identical amounts that
    // look exactly like a code that repeats.
    const short = masterRows().slice(0, 6).map((row) => [...row.slice(0, 3), 420, row[4]]);
    expect(detectSheetColumns(short).mapping.hCode).toBeUndefined();
    expect(detectSheetColumns(short).mapping.unitCode).toBeUndefined();
  });

  it("reads a 'หน่วยคุม' heading over names as the name, not the code", () => {
    // The same heading sits over a code in one เขต's file and over the name
    // in another's, because to them it is one column either way.
    const rows: unknown[][] = [
      ["เลขที่", "ชื่อ - สกุล", "หน่วยคุม", "หักไม่ได้"],
      [28590, "เสกสิน ศรีปากดี", "ตจว.1 หักผ่านธนาคารกรุงไทย", 7250],
      [30231, "ชนิสรา อุทโท", "ตจว.1 หักผ่านธนาคารกรุงไทย", 0],
      [29222, "ธีรภัทร ภูนาเพชร", "ตจว.2 หักผ่านธนาคารกรุงไทย", 6130],
    ];
    const reading = detectSheetColumns(rows);
    expect(reading.mapping.unitName).toBe(2);
    expect(reading.mapping.hCode).toBeUndefined();
  });

  it("reads a five- or six-digit 'หน่วยคุม' as the สังกัด's code", () => {
    // The cooperative has 64 หน่วยคุม, 1 to 1200 — four digits at most, by
    // its own สรุปหน่วยคุม. A longer number under that heading is the
    // สังกัด's code, and reading it as a หน่วยคุม filled the dropdown with
    // hundreds of units that do not exist.
    const rows: unknown[][] = [
      ["เลขที่", "ชื่อ - สกุล", "หน่วยคุม", "หักไม่ได้"],
      [28590, "เสกสิน ศรีปากดี", 520001, 7250],
      [30231, "ชนิสรา อุทโท", 520001, 0],
      [29222, "ธีรภัทร ภูนาเพชร", 520009, 6130],
    ];
    const reading = detectSheetColumns(rows);
    expect(reading.mapping.unitCode).toBe(2);
    expect(reading.mapping.hCode).toBeUndefined();
  });

  it("leaves a 'หน่วยคุม' heading over numbers as the code", () => {
    const rows: unknown[][] = [
      ["เลขที่", "ชื่อ - สกุล", "หน่วยคุม", "หักไม่ได้"],
      [28590, "เสกสิน ศรีปากดี", 75, 7250],
      [30231, "ชนิสรา อุทโท", 75, 0],
    ];
    expect(detectSheetColumns(rows).mapping).toMatchObject({ hCode: 2 });
  });

  it("keeps a headed รหัสสังกัด out of the หน่วยคุม", () => {
    const rows: unknown[][] = [
      ["เลขที่", "ชื่อ - สกุล", "หน่วยสังกัด", "สังกัด", "หน่วยคุม", "หักไม่ได้"],
      [28590, "เสกสิน ศรีปากดี", 7501, "ตจว.1 หักผ่านธนาคารกรุงไทย", 75, 7250],
    ];
    expect(detectSheetColumns(rows).mapping).toMatchObject({
      unitCode: 2,
      unitName: 3,
      hCode: 4,
    });
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
      unitCode: "520009",
      // This file names no หน่วยคุม at all, which is the ordinary case for a
      // unit's own sheet: its rows already know which unit they came from.
      hCode: null,
    });
  });

  it("counts the รวม line at the foot rather than importing it", () => {
    const reading = detectSheetColumns(unitFile);
    expect(readMappedSheet(unitFile, reading.firstDataRow, reading.mapping).skipped).toBe(1);
  });

  it("also skips it when the รวม label lands in the member number column itself", () => {
    // A different file's foot-of-sheet total wrote "รวม" under เลขที่ rather
    // than under ชื่อ — memberNumberKey passes it through as non-empty text,
    // so without isPlausibleMemberNumber this became a phantom "member"
    // named รวม with the file's grand total as their own ยอดหักไม่ได้.
    const reading = detectSheetColumns(unitFile);
    const withTotalInMemberColumn = [
      ...unitFile.slice(0, -1),
      ["", "รวม", "", 34100, 25900, 8200, "", ""],
    ];
    const read = readMappedSheet(withTotalInMemberColumn, reading.firstDataRow, reading.mapping);
    expect(read.rows.some((r) => r.memberNumber === "รวม")).toBe(false);
    expect(read.skipped).toBe(1);
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
