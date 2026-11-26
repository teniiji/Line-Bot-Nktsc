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

const grandTotal = (page: number, f: { members: string; inDebt: string; shares: string; total: string }) => [
  { page, x: 564.6, y: 30, width: 34, text: "รวมทั\u001cงหมด" },
  at(page, 564.5, 340.3, f.shares, 60),
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
      ...grandTotal(2, { members: "3", inDebt: "2", shares: "683,960.00", total: "222,200.00" }),
    ];
    const r = parseShareDebtPdf(items);
    expect(r.entries).toEqual([
      { memberNumber: "15885", memberName: "นายลิขิต ลำไธสง", shares: 531200, debt: 219000, sharePeriods: 429 },
      { memberNumber: "16261", memberName: "ว่าที่ร้อยตรีหญิงภุมรินทร์ อินกกผึ้ง", shares: 152760, debt: 0, sharePeriods: 0 },
      { memberNumber: "31230", memberName: "นายกฤษณะ เวียงสิมมา", shares: null, debt: 3200, sharePeriods: null },
    ]);
    expect(r.resigned).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => [c.label, c.read, c.report])).toEqual([
      ["จำนวนสมาชิก", 3, 3],
      ["สมาชิกที่เป็นหนี้", 2, 2],
      ["ทุนเรือนหุ้น", 683960, 683960],
      ["หนี้รวม", 222200, 222200],
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
        { memberNumber: "31230", shares: null, debt: 3200, sharePeriods: null },
      ])
    ).toEqual({
      entries: [
        { memberNumber: "15885", memberName: "ก", shares: 1.23, debt: 2, sharePeriods: 3 },
        { memberNumber: "31230", memberName: null, shares: null, debt: 3200, sharePeriods: null },
      ],
    });
    expect(cleanShareEntries([])).toHaveProperty("error");
    expect(cleanShareEntries([{ memberNumber: "x" }])).toHaveProperty("error");
    expect(cleanShareEntries([{ memberNumber: "15885", debt: "1e9" }])).toHaveProperty("error");
  });
});
