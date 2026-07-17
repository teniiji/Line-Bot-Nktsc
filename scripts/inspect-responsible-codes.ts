// Read-only inspection tool — does NOT touch the database. Prints sheet
// names, header rows, and a few sample rows from the member sheet and the
// responsible-person sheet, so the exact column layout can be confirmed
// before writing the real import against it. Run this locally, on your
// own machine, against the real spreadsheet.
//
// Usage: npx tsx scripts/inspect-responsible-codes.ts <path-to-xlsx>

import ExcelJS from "exceljs";

const MEMBER_SHEET_NAME = "สมาชิก_LINE_OA";
const RESPONSIBLE_CODE_COLUMN = 8; // column H
const RESPONSIBLE_SHEET_CANDIDATES = ["ผู้รับผิดชอบ", "รับผิดชอบ"];

function colLetter(index: number): string {
  return String.fromCharCode(64 + index);
}

function printHeaderAndSamples(
  sheet: ExcelJS.Worksheet,
  maxCols: number,
  sampleRows: number
) {
  console.log(`  (${sheet.rowCount} rows total)`);
  console.log("  Header row (row 1):");
  const header = sheet.getRow(1);
  for (let c = 1; c <= maxCols; c++) {
    const v = header.getCell(c).value;
    if (v === null || v === undefined) continue;
    console.log(`    Col ${colLetter(c)}: ${v}`);
  }
  console.log(`  Sample data rows (2-${1 + sampleRows}):`);
  for (let r = 2; r <= 1 + sampleRows && r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const vals: unknown[] = [];
    for (let c = 1; c <= maxCols; c++) vals.push(row.getCell(c).value);
    console.log(`    Row ${r}:`, vals);
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/inspect-responsible-codes.ts <path-to-xlsx>");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  console.log("=== Sheets in workbook ===");
  workbook.eachSheet((sheet) => console.log(`  - "${sheet.name}" (${sheet.rowCount} rows)`));

  console.log(`\n=== "${MEMBER_SHEET_NAME}" ===`);
  const memberSheet = workbook.getWorksheet(MEMBER_SHEET_NAME);
  if (!memberSheet) {
    console.log(`  ⚠️ Sheet "${MEMBER_SHEET_NAME}" not found.`);
  } else {
    printHeaderAndSamples(memberSheet, 9, 3);

    const codes = new Set<string>();
    let blankCount = 0;
    for (let r = 2; r <= memberSheet.rowCount; r++) {
      const raw = memberSheet.getRow(r).getCell(RESPONSIBLE_CODE_COLUMN).value;
      const s = raw === null || raw === undefined ? "" : String(raw).trim();
      if (!s || s === "-" || s.toLowerCase() === "nan") blankCount++;
      else codes.add(s);
    }
    console.log(
      `\n  Column ${colLetter(RESPONSIBLE_CODE_COLUMN)} (รหัสผู้รับผิดชอบ): ${codes.size} distinct non-blank codes, ${blankCount} blank/nan rows out of ${memberSheet.rowCount - 1} data rows`
    );
    console.log(
      "  Sample distinct codes:",
      Array.from(codes).slice(0, 15).join(", ")
    );
  }

  console.log(`\n=== Responsible-person sheet ===`);
  let respSheet: ExcelJS.Worksheet | undefined;
  let respSheetName = "";
  for (const name of RESPONSIBLE_SHEET_CANDIDATES) {
    respSheet = workbook.getWorksheet(name);
    if (respSheet) {
      respSheetName = name;
      break;
    }
  }
  if (!respSheet) {
    console.log(
      `  ⚠️ No sheet found matching ${RESPONSIBLE_SHEET_CANDIDATES.map((n) => `"${n}"`).join(" or ")}.`
    );
  } else {
    console.log(`  Found: "${respSheetName}"`);
    printHeaderAndSamples(respSheet, 6, 8);
  }
}

main().catch((err) => {
  console.error("Inspection failed:", err);
  process.exit(1);
});
