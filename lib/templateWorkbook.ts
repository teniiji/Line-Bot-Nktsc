// Turning a SheetTemplate into an actual .xlsx.
//
// Server-side because ExcelJS is already a dependency here and shipping it to
// the browser to write a five-row file would cost every visitor a megabyte of
// JavaScript. The download is a plain link to a route; nothing runs on the
// client at all.
//
// .xlsx rather than CSV because that is what the importers accept — a
// template you cannot feed back in is a worked example, not a template.

import ExcelJS from "exceljs";
import { templateRows, type SheetTemplate } from "./sheetTemplates";

export async function buildTemplateWorkbook(template: SheetTemplate): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(template.sheetName);

  for (const row of templateRows(template)) sheet.addRow(row);

  sheet.columns = template.widths.map((width) => ({ width }));

  // Row 1 is the instruction, row 2 the headings. Both are formatting only —
  // the parsers read values and ignore all of this.
  const note = sheet.getRow(1);
  note.font = { italic: true, color: { argb: "FF8A6D00" } };
  const header = sheet.getRow(2);
  header.font = { bold: true };
  // So the headings stay visible while somebody types a thousand rows.
  sheet.views = [{ state: "frozen", ySplit: 2 }];

  // Member numbers, national IDs and phone numbers are text, not quantities:
  // left as general, Excel turns "010175" into 10175 and "0807597560" into
  // 807597560 the moment the file is edited and saved. The importer repairs
  // both cases, but the file should not create them in the first place.
  for (const column of sheet.columns) column.numFmt = "@";

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
