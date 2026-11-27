// รายชื่อสมาชิกที่หลักประกันไม่ครอบคลุมหนี้ — the printed list staff asked
// for, one row a member:
//
//   ที่ | เลขสมาชิก | ชื่อ-สกุล | หน่วยงาน | อายุ | หนี้ | หลักประกันไม่พอ
//
// under a two-line title with the date the shares and debt are as of, and a
// total row. Laid out for A4, with the headings repeated on every page.

import ExcelJS from "exceljs";
import type { CoverageRow } from "./coverage";

export const COOP_NAME = "สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด";
const HEADINGS = ["ที่", "เลขสมาชิก", "ชื่อ-สกุล", "หน่วยงาน", "อายุ", "หนี้", "หลักประกันไม่พอ"];
const WIDTHS = [6, 13, 30, 30, 7, 24, 24];
const FONT = "TH SarabunPSK";
const MONEY = "#,##0.00";

export const thaiShortDate = (d: Date) =>
  d.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });

export const shortfallFileName = (asOf: Date) =>
  `สมาชิกหลักประกันไม่พอ_${thaiShortDate(asOf).replace(/\s+/g, "_")}.xlsx`;

const round2 = (x: number) => Math.round(x * 100) / 100;

// The rows that go in: members whose collateral falls short, with how much.
export function shortfallRows(rows: CoverageRow[]) {
  return rows
    .filter((r) => r.margin < 0)
    .map((r, i) => ({
      no: i + 1,
      memberNumber: r.memberNumber,
      name: r.memberName ?? "",
      unit: r.unitName ?? "",
      age: r.age,
      debt: r.debt,
      shortfall: round2(-r.margin),
    }));
}

export async function buildShortfallWorkbook(rows: CoverageRow[], opts: { asOf: Date }): Promise<Buffer> {
  const items = shortfallRows(rows);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("หลักประกันไม่พอ", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      printTitlesRow: "4:4",
    },
    headerFooter: { oddFooter: "หน้า &P / &N" },
    views: [{ state: "frozen", ySplit: 4 }],
  });
  sheet.columns = WIDTHS.map((width) => ({ width }));

  const title = (row: number, text: string) => {
    sheet.mergeCells(row, 1, row, HEADINGS.length);
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = { name: FONT, size: 18, bold: true };
    cell.alignment = { horizontal: "center" };
  };
  title(1, `รายชื่อสมาชิก${COOP_NAME}`);
  title(2, `ที่หลักประกันไม่ครอบคลุมหนี้ ณ ${thaiShortDate(opts.asOf)}`);

  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  const header = sheet.getRow(4);
  header.values = HEADINGS;
  header.eachCell((cell) => {
    cell.font = { name: FONT, size: 16, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });

  for (const it of items) {
    const row = sheet.addRow([it.no, it.memberNumber, it.name, it.unit, it.age, it.debt, it.shortfall]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: FONT, size: 16 };
      cell.border = border;
    });
    row.alignment = { vertical: "top" };
    row.getCell(1).alignment = { horizontal: "center", vertical: "top" };
    // A long name or unit wraps onto a second line rather than being cut off.
    row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    row.getCell(4).alignment = { wrapText: true, vertical: "top" };
    // Member numbers are text: "010175" must not become 10175.
    row.getCell(2).numFmt = "@";
    row.getCell(2).alignment = { horizontal: "center", vertical: "top" };
    row.getCell(5).alignment = { horizontal: "center", vertical: "top" };
    row.getCell(6).numFmt = MONEY;
    row.getCell(7).numFmt = MONEY;
  }

  const total = sheet.addRow([
    `รวม ${items.length.toLocaleString("th-TH")} คน`,
    null,
    null,
    null,
    null,
    round2(items.reduce((s, it) => s + it.debt, 0)),
    round2(items.reduce((s, it) => s + it.shortfall, 0)),
  ]);
  sheet.mergeCells(total.number, 1, total.number, 5);
  total.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: FONT, size: 16, bold: true };
    cell.border = border;
  });
  total.getCell(1).alignment = { horizontal: "center" };
  total.getCell(6).numFmt = MONEY;
  total.getCell(7).numFmt = MONEY;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
