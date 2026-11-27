import { describe, expect, it } from "vitest";
import { cleanThai, parseShareDebtPdf, ShareDebtPdfError, type PdfTextItem } from "../lib/shareDebtPdf";
import { cleanShareEntries } from "../lib/shareDebt";

// Places a figure so that it ends where its column ends, as the report
// right-aligns them.
const at = (page: number, x: number, end: number, text: string, width = 40): PdfTextItem => ({
  page,
  x,
  y: end - width,
  width,
  text,
});

const member = (page: number, x: number, no: string, name: string, f: { periods?: string; shares?: string; total?: string; resigned?: boolean }) => [
  at(page, x + 0.3, 90.1, no, 42.22),
  { page, x: x + 0.3, y: 100.44, width: 80, text: name },
  ...(f.periods ? [at(page, x, 254.8, f.periods, 14)] : []),
  at(page, x - 0.4, 281.1, "560", 14),
  ...(f.shares ? [at(page, x, 340.4, f.shares, 42)] : []),
  at(page, x, 506.8, "100.00"),
  ...(f.resigned ? [{ page, x, y: 600, width: 30, text: "ลาออกวันที" }] : []),
  ...(f.total ? [at(page, x - 1, 930.7, f.total, 48)] : []),
  at(page, x - 1, 1010.1, "9.00", 30),
];

const grandTotal = (
  page: number,
  f: { members: string; inDebt: string; shares: string; total: string; emergency?: string; ordinary?: string; special?: string }
) => [
  { page, x: 564.6, y: 30, width: 34, text: "รวมทั\u001cงหมด" },
  at(page, 564.5, 340.3, f.shares, 60),
  at(page, 564.5, 506.8, f.emergency ?? "0.00", 60),
  at(page, 564.5, 675.5, f.ordinary ?? "0.00", 60),
  at(page, 564.5, 859.3, f.special ?? "0.00", 60),
  at(page, 563.8, 931.4, f.total, 60),
  { page, x: 592.3, y: 40, width: 70, text: "จํานวนสมาชิกทีเป็นหนี\u001c" },
  at(page, 592.2, 187.3, f.inDebt, 20),
  { page, x: 616.3, y: 40, width: 70, text: "จํานวนสมาชิกทีไม่เป็นหนี\u001c" },
  at(page, 616.2, 187.3, "1", 20),
  { page, x: 642.6, y: 40, width: 40, text: "จํานวนสมาชิก" },
  at(page, 642.5, 187.3, f.members, 20),
];

describe("parseShareDebtPdf", () => {
  it("reads members by where their figures end and checks them against the grand total", () => {
    const items = [
      ...member(1, 186, "00015885", "นายลิขิต ลําไธสง", { periods: "429", shares: "531,200.00", total: "219,000.00" }),
      ...member(1, 211, "00016261", "ว่าที\u0016ร้อยตรีหญิงภุมรินทร์ อินกกผึTง", { periods: "0", shares: "152,760.00", total: "0.00" }),
      // Continued on the next page without totals: ignored.
      ...member(2, 186, "00016261", "", {}),
      ...member(2, 211, "00031230", "นายกฤษณะ เวียงสิมมา", { total: "3,200.00", resigned: true }),
      ...grandTotal(2, { members: "3", inDebt: "2", shares: "683,960.00", total: "222,200.00", emergency: "400.00" }),
    ];
    const r = parseShareDebtPdf(items);
    // Each member line carries 100.00 in the emergency balance column; the
    // page-2 repeat adds its own to 16261's.
    expect(r.entries.map((e) => e.contracts?.length)).toEqual([1, 2, 1]);
    expect(r.entries.map(({ contracts: _c, ...e }) => e)).toEqual([
      { memberNumber: "15885", memberName: "นายลิขิต ลำไธสง", shares: 531200, debt: 219000, sharePeriods: 429, resigned: false },
      { memberNumber: "16261", memberName: "ว่าที่ร้อยตรีหญิงภุมรินทร์ อินกกผึ้ง", shares: 152760, debt: 0, sharePeriods: 0, resigned: false },
      { memberNumber: "31230", memberName: "นายกฤษณะ เวียงสิมมา", shares: null, debt: 3200, sharePeriods: null, resigned: true },
    ]);
    expect(r.resigned).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => [c.label, c.read, c.report])).toEqual([
      ["จำนวนสมาชิก", 3, 3],
      ["สมาชิกที่เป็นหนี้", 2, 2],
      ["ทุนเรือนหุ้น", 683960, 683960],
      ["หนี้รวม", 222200, 222200],
      ["เงินกู้ฉุกเฉินคงเหลือ (รายสัญญา)", 400, 400],
      ["เงินกู้สามัญคงเหลือ (รายสัญญา)", 0, 0],
      ["เงินกู้พิเศษคงเหลือ (รายสัญญา)", 0, 0],
    ]);
  });

  it("is not ok when the figures do not add up, or the grand total is missing", () => {
    const rows = member(1, 186, "00015885", "นาย ก", { periods: "1", shares: "10.00", total: "5.00" });
    const wrong = parseShareDebtPdf([...rows, ...grandTotal(1, { members: "1", inDebt: "1", shares: "10.00", total: "6.00" })]);
    expect(wrong.ok).toBe(false);
    expect(wrong.checks.find((c) => c.label === "หนี้รวม")).toMatchObject({ read: 5, report: 6, ok: false });
    const missing = parseShareDebtPdf(rows);
    expect(missing.ok).toBe(false);
    expect(missing.checks.every((c) => c.report === null)).toBe(true);
  });

  it("refuses a PDF with no member lines", () => {
    expect(() => parseShareDebtPdf([{ page: 1, x: 10, y: 10, width: 50, text: "ใบเสร็จรับเงิน" }])).toThrow(ShareDebtPdfError);
  });

  it("puts the report font's marks back", () => {
    expect(cleanThai("ชื\u0016อ - หนี\u001c ตํ\u0016า")).toBe("ชื่อ - หนี้ ต่ำ");
  });
});

describe("cleanShareEntries", () => {
  it("keeps valid figures, drops repeats and refuses bad ones", () => {
    expect(
      cleanShareEntries([
        { memberNumber: "00015885", memberName: "ก", shares: 1.234, debt: 2, sharePeriods: 3.7 },
        { memberNumber: "15885", shares: 9, debt: 9, sharePeriods: 9 },
        { memberNumber: "31230", shares: null, debt: 3200, sharePeriods: null, resigned: true },
      ])
    ).toEqual({
      entries: [
        { memberNumber: "15885", memberName: "ก", shares: 1.23, debt: 2, sharePeriods: 3, contracts: null, resigned: false },
        { memberNumber: "31230", memberName: null, shares: null, debt: 3200, sharePeriods: null, contracts: null, resigned: true },
      ],
    });
    expect(cleanShareEntries([])).toHaveProperty("error");
    expect(cleanShareEntries([{ memberNumber: "x" }])).toHaveProperty("error");
    expect(cleanShareEntries([{ memberNumber: "15885", debt: "1e9" }])).toHaveProperty("error");
  });
});

describe("contracts in the printed report", () => {
  // Page numbers in the cipher font: page 1 of 2 is "% / +".
  const header = (page: number, shown: string) => ({ page, x: 53, y: 964, width: 56, text: `หน้าที\u0016 : ${shown}` });
  const fig = (page: number, x: number, end: number, text: string, width = 40) => at(page, x, end, text, width);
  const contract = (page: number, x: number, start: number, text: string) => ({ page, x, y: start, width: 45, text });

  it("reads each contract, decodes its number from the page numbers, and joins a member split over pages", () => {
    const items = [
      header(1, "% / +"),
      header(2, "+ / +"),
      ...member(1, 186, "00028124", "นางสุภาพร ศรีสุระ", { periods: "149", shares: "566,880.00", total: "4,191,281.75" }).filter(
        (i) => !(Math.abs(i.y + i.width - 506.8) < 1)
      ),
      fig(1, 186, 355.5, "39", 9),
      contract(1, 186, 365.5, "AT6602872"),
      fig(1, 186, 452.8, "13,000", 25),
      fig(1, 186, 506.8, "1,420,073.00", 49),
      fig(1, 186, 523.1, "26", 9),
      contract(1, 186, 533.8, "สป+%+"),
      fig(1, 186, 620.1, "17,200", 25),
      fig(1, 186, 675.5, "2,333,514.75", 49),
      // the next line: one more contract
      fig(1, 210.7, 523.1, "10", 9),
      contract(1, 210.7, 534.1, "สด%+"),
      fig(1, 210.7, 620.1, "8,000", 25),
      fig(1, 210.7, 675.5, "437,694.00", 42),
      // a unit total below it ends the member's lines
      { page: 1, x: 235, y: 20, width: 40, text: "รวมหน่วย" },
      fig(1, 235, 506.8, "9,999,999.00", 49),
      // printed again on page 2 with the rest
      at(2, 186.3, 90.1, "00028124", 42.22),
      fig(2, 186, 859.3, "100.00", 30),
      contract(2, 186, 703.8, "พอ+"),
    ];
    const r = parseShareDebtPdf(items);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].contracts).toEqual([
      { type: "emergency", contractNo: "AT6602872", installment: 39, payment: 13000, balance: 1420073 },
      { type: "ordinary", contractNo: "สป212", installment: 26, payment: 17200, balance: 2333514.75 },
      { type: "ordinary", contractNo: "สด12", installment: 10, payment: 8000, balance: 437694 },
      { type: "special", contractNo: "พอ2", installment: null, payment: null, balance: 100 },
    ]);
  });
});

describe("cleanShareEntries with contracts", () => {
  it("keeps valid contracts and refuses malformed ones", () => {
    const ok = cleanShareEntries([
      { memberNumber: "15885", debt: 219000, contracts: [{ type: "ordinary", contractNo: "สป601341", installment: 109, payment: 9000, balance: 219000 }] },
    ]);
    expect(ok).toEqual({
      entries: [
        {
          memberNumber: "15885",
          memberName: null,
          shares: null,
          debt: 219000,
          sharePeriods: null,
          contracts: [{ type: "ordinary", contractNo: "สป601341", installment: 109, payment: 9000, balance: 219000 }],
          resigned: false,
        },
      ],
    });
    expect(cleanShareEntries([{ memberNumber: "15885", contracts: [{ type: "car", balance: 1 }] }])).toHaveProperty("error");
    expect(cleanShareEntries([{ memberNumber: "15885", contracts: [{ type: "ordinary" }] }])).toHaveProperty("error");
  });
});
