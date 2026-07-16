// One-off/occasional import: reads the cooperative's "ผู้รับผิดชอบ" (loan
// contact) spreadsheet — one row per organizational unit with the LINE
// user ID of the staff member responsible for สินเชื่อ (loan) service
// requests from that unit's members — and upserts it into
// LoanDistrictContact, keyed by the exact unit name so it matches
// MemberRoster.unitName at lookup time (see resolveForwardTarget in
// lib/financeAgent.ts). Also reports which unit names in the spreadsheet
// have no matching MemberRoster.unitName in the database, since a mismatch
// there means that unit's members will silently fall back to
// LINE_FORWARD_LOAN_ID instead of their real contact — never commit the
// source spreadsheet itself (it has real staff LINE user IDs) to this repo.
//
// Sheet: "รับผิดชอบ" — columns (1-indexed): 1 UserID, 2 สังกัด, 3 ตัวย่อ,
// 4 ผู้รับผิดชอบ. Header row is row 1, data starts row 2.
//
// Usage: npx tsx scripts/import-loan-contacts.ts <path-to-xlsx>

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SHEET_NAME = "รับผิดชอบ";

function cell(row: ExcelJS.Row, index: number): string | null {
  const value = row.getCell(index).value;
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str && str !== "-" ? str : null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-loan-contacts.ts <path-to-xlsx>");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${SHEET_NAME}" not found in ${filePath}.`);
    process.exit(1);
  }

  const rosterUnits = new Set(
    (await prisma.memberRoster.findMany({ select: { unitName: true } }))
      .map((r) => r.unitName)
      .filter((u): u is string => !!u)
  );

  let imported = 0;
  let skipped = 0;
  const unmatched: string[] = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const lineUserId = cell(row, 1);
    const unitName = cell(row, 2);
    const note = cell(row, 4);
    if (!lineUserId || !unitName) {
      skipped++;
      continue;
    }

    if (!rosterUnits.has(unitName)) {
      unmatched.push(unitName);
    }

    await prisma.loanDistrictContact.upsert({
      where: { unitName },
      create: { unitName, lineUserId, note },
      update: { lineUserId, note },
    });
    imported++;
  }

  console.log(`LoanDistrictContact: ${imported} imported, ${skipped} skipped`);

  if (unmatched.length > 0) {
    console.log(
      `\n⚠️  ${unmatched.length} unit name(s) from the spreadsheet have no exact match in MemberRoster.unitName — members in these units will fall back to LINE_FORWARD_LOAN_ID until the names line up:`
    );
    for (const u of unmatched) {
      console.log(`  - ${u}`);
    }
  } else {
    console.log("\nAll unit names matched MemberRoster.unitName exactly.");
  }
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
