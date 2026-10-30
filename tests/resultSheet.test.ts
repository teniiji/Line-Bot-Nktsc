import { describe, expect, it } from "vitest";
import { chooseResultSheet, hasResultColumns, resultSheetNote, sheetsWithResults } from "../lib/resultSheet";
import { detectSheetColumns } from "../lib/sheetColumns";
import { readMappedSheet } from "../lib/mappedSheet";

// The บำนาญหน่วยงานกลาง workbook, October 2569: page "1" is the list, page
// "ไม่ได้" has the results, and on both the headings sit one column left of
// what they name because the ลำดับ column has none.
const banner = [["สหกรณ์ออมทรัพย์ครูหนองคาย  จำกัด"], ["รายการหัก บำนาญ หน่วยงานกลาง ประจำ เดือน ตุลาคม 2569"]];
const people: [number, string, number, number][] = [
  [2260, "นายมงคล วิสุทธิศรี", 500, 840],
  [6223, "นางอำไพ เราวิลัย", 1100, 840],
  [6939, "นางประนอม จิตต์อำมาตย์", 5000, 420],
  [11933, "นางปิยพร รักขพันธ์ ณ หนองคาย", 13400, 0],
  [14801, "นางสมพร ทดสอบ", 15320, 840],
  [21508, "นายสมชาย ทดสอบ", 2000, 840],
  [24172, "นางสมศรี ทดสอบ", 3000, 0],
];
const listSheet = [
  ...banner,
  ["เลขที่", "ชื่อ  -  สกุล", "แจ้งหัก", "สหกรณ์", "สสค", "รวม"],
  ...people.map(([no, name, coop, sk], i) => [i + 1, no, name, coop, sk, coop + sk, 740005, "บำนาญหน่วยงานกลาง สหกรณ์ฯ"]),
];
const resultSheet = [
  ...banner,
  ["เลขที่", "ชื่อ  -  สกุล", "แจ้งหัก", "สหกรณ์", "สสค", "รวม", "หักได้", "หักไม่ได้"],
  ...people.map(([no, name, coop, sk], i) => [
    i + 1, no, name, coop, sk, coop + sk, 0, coop + sk, 740005, "บำนาญหน่วยงานกลาง สหกรณ์ฯ",
  ]),
];

describe("a heading row one cell short", () => {
  it("reads member numbers, not the ลำดับ beside them", () => {
    const reading = detectSheetColumns(resultSheet);
    expect(reading.mapping.memberNumber).toBe(1);
    expect(reading.mapping.name).toBe(2);
    // สหกรณ์ — the cooperative's own share, not the name column.
    expect(reading.mapping.expected).toBe(3);
    expect(reading.mapping.collected).toBe(6);
    expect(reading.mapping.uncollected).toBe(7);

    const read = readMappedSheet(resultSheet, reading.firstDataRow, reading.mapping);
    expect(read.rows.map((row) => row.memberNumber)).toEqual(people.map(([no]) => String(no)));
    expect(read.uncollected).toBe(7);
    expect(read.awaiting).toBe(0);
  });

  it("leaves a heading row that lines up alone", () => {
    const aligned = [
      ["ลำดับ", "เลขสมาชิก", "ชื่อ - สกุล", "หักได้", "หักไม่ได้"],
      ...people.map(([no, name, coop], i) => [i + 1, no, name, coop, 0]),
    ];
    const reading = detectSheetColumns(aligned);
    expect(reading.mapping.memberNumber).toBe(1);
    expect(reading.mapping.name).toBe(2);
  });
});

describe("which page holds the results", () => {
  const readings = [listSheet, resultSheet].map((rows, index) => ({
    index,
    mapping: detectSheetColumns(rows).mapping,
  }));

  it("passes over a list page with no results on it", () => {
    expect(hasResultColumns(readings[0].mapping)).toBe(false);
    expect(sheetsWithResults(readings)).toEqual([1]);
    expect(chooseResultSheet(readings)).toBe(1);
  });

  it("keeps page one when it has the results", () => {
    expect(chooseResultSheet([readings[1], { ...readings[0], index: 1 }].map((r, index) => ({ ...r, index })))).toBe(0);
  });

  it("keeps page one when no page has results", () => {
    expect(chooseResultSheet([readings[0]])).toBe(0);
  });

  const sheets = [
    { index: 0, name: "1" },
    { index: 1, name: "ไม่ได้" },
  ];

  it("says the page was chosen for the person", () => {
    const note = resultSheetNote({ sheets, sheetIndex: 1, mapping: readings[1].mapping, resultSheets: [1], autoPicked: true });
    expect(note?.tone).toBe("info");
    expect(note?.text).toContain('"ไม่ได้"');
  });

  it("warns that a page without results records nobody, and names the right one", () => {
    const note = resultSheetNote({ sheets, sheetIndex: 0, mapping: readings[0].mapping, resultSheets: [1], autoPicked: false });
    expect(note?.tone).toBe("warn");
    expect(note?.text).toContain("รอผลการหัก");
    expect(note?.text).toContain('ผลการหักอยู่ที่ชีต "ไม่ได้"');
  });

  it("points at the column pickers when no page has results", () => {
    const note = resultSheetNote({ sheets, sheetIndex: 0, mapping: readings[0].mapping, resultSheets: [], autoPicked: false });
    expect(note?.text).toContain("เลือกช่องยอดหักได้");
  });

  it("says nothing once the page has results and was picked by hand", () => {
    expect(
      resultSheetNote({ sheets, sheetIndex: 1, mapping: readings[1].mapping, resultSheets: [1], autoPicked: false })
    ).toBeNull();
  });
});
