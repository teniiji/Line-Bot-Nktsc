// One-off/occasional import: reads the cooperative's "ผู้รับผิดชอบ" sheet
// — a short code-to-officer lookup (far fewer rows than the unit-name-based
// LoanDistrictContact table) — and upserts it into ResponsibleContact.
// This is the PRIMARY loan-routing mechanism: each member's
// responsibleCode (imported from the "สมาชิก_LINE_OA" sheet's column H via
// import-org-data.ts) is looked up here first in resolveForwardTarget
// (lib/financeAgent.ts), before falling back to unit-name matching. Never
// commit the source spreadsheet itself (it has real staff LINE user IDs)
// to this repo.
//
// Sheet: "ผู้รับผิดชอบ" — columns (1-indexed): 1 รหัสผู้รับผิดชอบ (code),
// 2 UserId Line. Header row is row 1, data starts row 2.
//
// Usage: npx tsx scripts/import-responsible-contacts.ts <path-to-xlsx>

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { cellText as cell } from "./excelUtils";

const prisma = new PrismaClient();
const SHEET_NAME = "ผู้รับผิดชอบ";
const CODE_COLUMN = 1; // column A
const LINE_USER_ID_COLUMN = 2; // column B

// Shows enough of the LINE user ID to eyeball-match against the source
// spreadsheet without printing the full, sensitive value to the terminal.
function maskLineUserId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-responsible-contacts.ts <path-to-xlsx>");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${SHEET_NAME}" not found in ${filePath}.`);
    process.exit(1);
  }

  // Printed up front so a wrong column assumption (CODE_COLUMN /
  // LINE_USER_ID_COLUMN above) is obvious immediately, before anything is
  // written to the database.
  const header = sheet.getRow(1);
  console.log(
    `Header check — Col A: "${header.getCell(1).value}", Col B: "${header.getCell(2).value}"\n`
  );

  let imported = 0;
  let skipped = 0;
  const contacts: { code: string; lineUserId: string }[] = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const code = cell(row, CODE_COLUMN);
    const lineUserId = cell(row, LINE_USER_ID_COLUMN);
    if (!code || !lineUserId) {
      skipped++;
      continue;
    }

    await prisma.responsibleContact.upsert({
      where: { code },
      create: { code, lineUserId },
      update: { lineUserId },
    });
    contacts.push({ code, lineUserId });
    imported++;
  }

  console.log(`ResponsibleContact: ${imported} imported, ${skipped} skipped\n`);
  console.log("Imported mapping (verify this matches the spreadsheet):");
  for (const c of contacts) {
    console.log(`  รหัส "${c.code}" -> ${maskLineUserId(c.lineUserId)}`);
  }

  // Cross-check against MemberRoster.responsibleCode so a code that
  // members actually use but that's missing from this sheet is caught
  // immediately, the same way import-loan-contacts.ts reports unmatched
  // unit names.
  const usedCodes = await prisma.memberRoster.findMany({
    where: { responsibleCode: { not: null } },
    select: { responsibleCode: true },
    distinct: ["responsibleCode"],
  });
  const knownCodes = new Set(contacts.map((c) => c.code));
  const unmatched = usedCodes
    .map((r) => r.responsibleCode)
    .filter((c): c is string => c !== null && !knownCodes.has(c));

  if (unmatched.length > 0) {
    console.log(
      `\n⚠️  ${unmatched.length} responsibleCode value(s) used in MemberRoster have no match here — those members fall back to unitName routing, then LINE_FORWARD_LOAN_ID:`
    );
    for (const c of unmatched) console.log(`  - "${c}"`);
  } else {
    console.log("\nAll responsibleCode values used in MemberRoster are covered.");
  }
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
