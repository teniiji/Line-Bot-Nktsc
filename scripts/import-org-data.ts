// One-off/occasional import: reads the cooperative's existing "หน่วยงาน" /
// "สมาชิก_LINE_OA" spreadsheet and upserts it into OrganizationUnit /
// MemberRoster. Run locally against a real DATABASE_URL — never commit the
// source spreadsheet itself (it contains real members' names and LINE
// user IDs) to this repo.
//
// Usage: npx tsx scripts/import-org-data.ts <path-to-xlsx>

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { cellText as cell } from "./excelUtils";

const prisma = new PrismaClient();

const ORG_SHEET_NAME = "หน่วยงาน";
const MEMBER_SHEET_NAME = "สมาชิก_LINE_OA";

async function importOrganizationUnits(workbook: ExcelJS.Workbook) {
  const sheet = workbook.getWorksheet(ORG_SHEET_NAME);
  if (!sheet) {
    console.warn(`Sheet "${ORG_SHEET_NAME}" not found, skipping.`);
    return { imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;

  // Columns (1-indexed), per the sheet's header row:
  // 1 ลำดับ, 2 กลุ่ม, 3 ชื่อหน่วยงาน, 4 วิธีส่ง, 5 ผู้รับ/ชื่อ, 6 อีเมล,
  // 7 LINE_UserID_ผู้รับ, 8 ชื่อไฟล์_template, 9 หมายเหตุ
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const name = cell(row, 3);
    if (!name) {
      skipped++;
      continue;
    }
    await prisma.organizationUnit.upsert({
      where: { name },
      create: {
        name,
        groupName: cell(row, 2),
        contactMethod: cell(row, 4),
        contactName: cell(row, 5),
        email: cell(row, 6),
        lineUserId: cell(row, 7),
        note: cell(row, 9),
      },
      update: {
        groupName: cell(row, 2),
        contactMethod: cell(row, 4),
        contactName: cell(row, 5),
        email: cell(row, 6),
        lineUserId: cell(row, 7),
        note: cell(row, 9),
      },
    });
    imported++;
  }

  return { imported, skipped };
}

async function importMemberRoster(workbook: ExcelJS.Workbook) {
  const sheet = workbook.getWorksheet(MEMBER_SHEET_NAME);
  if (!sheet) {
    console.warn(`Sheet "${MEMBER_SHEET_NAME}" not found, skipping.`);
    return { imported: 0, skipped: 0, missingUnit: 0, missingResponsibleCode: 0 };
  }

  let imported = 0;
  let skipped = 0;
  let missingUnit = 0;
  let missingResponsibleCode = 0;

  // Columns (1-indexed): 1 เลขสมาชิก, 2 ชื่อสมาชิก, 3 หน่วยงาน,
  // 4 LINE_UserID, 5 Nickname (LINE OA), ... 8 รหัสผู้รับผิดชอบ
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const memberNumber = cell(row, 1);
    const memberName = cell(row, 2);
    if (!memberNumber || !memberName) {
      skipped++;
      continue;
    }
    const unitName = cell(row, 3);
    if (!unitName) missingUnit++;
    const responsibleCode = cell(row, 8);
    if (!responsibleCode) missingResponsibleCode++;
    await prisma.memberRoster.upsert({
      where: { memberNumber },
      create: {
        memberNumber,
        memberName,
        unitName,
        responsibleCode,
        lineUserId: cell(row, 4),
        nickname: cell(row, 5),
      },
      update: {
        memberName,
        unitName,
        responsibleCode,
        lineUserId: cell(row, 4),
        nickname: cell(row, 5),
      },
    });
    imported++;
  }

  return { imported, skipped, missingUnit, missingResponsibleCode };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-org-data.ts <path-to-xlsx>");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const orgResult = await importOrganizationUnits(workbook);
  console.log(
    `OrganizationUnit: ${orgResult.imported} imported, ${orgResult.skipped} skipped`
  );

  const memberResult = await importMemberRoster(workbook);
  console.log(
    `MemberRoster: ${memberResult.imported} imported, ${memberResult.skipped} skipped`
  );
  if (memberResult.missingUnit > 0) {
    console.log(
      `\n⚠️  ${memberResult.missingUnit} of ${memberResult.imported} imported member(s) have no หน่วยงาน (blank, "-", or a pandas-style "nan" cell) — these members fall back to responsibleCode routing, then LINE_FORWARD_LOAN_ID, for loan requests.`
    );
  }
  if (memberResult.missingResponsibleCode > 0) {
    console.log(
      `⚠️  ${memberResult.missingResponsibleCode} of ${memberResult.imported} imported member(s) have no รหัสผู้รับผิดชอบ (column H) — these members fall back to unitName routing, then LINE_FORWARD_LOAN_ID, for loan requests.`
    );
  }
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
