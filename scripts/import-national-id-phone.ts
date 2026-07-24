// One-off import: backfills MemberRoster.nationalId/phone (used by the
// member-number-lookup identity check, lib/memberLookup.ts) from columns
// F/G of the cooperative's "สมาชิก_LINE_OA" sheet. Deliberately narrow —
// unlike import-org-data.ts, this ONLY ever touches nationalId/phone on
// rows that already exist (matched by memberNumber). It never creates a
// new MemberRoster row and never touches unitName/responsibleCode/
// lineUserId/nickname, so it can't disturb loan-routing or anything else
// already working from an earlier import.
//
// A row is skipped (left as-is) whenever its national ID isn't exactly 13
// digits or its phone isn't a clean 9/10-digit number, rather than
// guessing — the goal is "member merely can't be identity-verified yet"
// (safe), never "identity-verified against a wrong number" (unsafe).
//
// Run locally against a real DATABASE_URL — never commit the source
// spreadsheet itself (it contains real members' national ID numbers) to
// this repo.
//
// Usage: npx tsx scripts/import-national-id-phone.ts <path-to-xlsx>

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { cellText as cell } from "./excelUtils";
import { parseNationalId, parsePhone } from "../lib/identityFormat";

const prisma = new PrismaClient();

const MEMBER_SHEET_NAME = "สมาชิก_LINE_OA";
const NATIONAL_ID_COLUMN = 6; // F
const PHONE_COLUMN = 7; // G

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-national-id-phone.ts <path-to-xlsx>");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(MEMBER_SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${MEMBER_SHEET_NAME}" not found.`);
    process.exit(1);
  }

  let updated = 0;
  let noMemberNumber = 0;
  let notInRoster = 0;
  let nothingValidToUpdate = 0;
  let invalidNationalId = 0;
  let invalidPhone = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const memberNumber = cell(row, 1);
    if (!memberNumber) {
      noMemberNumber++;
      continue;
    }

    const rawNationalId = cell(row, NATIONAL_ID_COLUMN);
    const rawPhone = cell(row, PHONE_COLUMN);
    const nationalId = parseNationalId(rawNationalId);
    const phone = parsePhone(rawPhone);
    if (rawNationalId && !nationalId) invalidNationalId++;
    if (rawPhone && !phone) invalidPhone++;

    if (!nationalId && !phone) {
      nothingValidToUpdate++;
      continue;
    }

    try {
      await prisma.memberRoster.update({
        where: { memberNumber },
        data: {
          ...(nationalId ? { nationalId } : {}),
          ...(phone ? { phone } : {}),
        },
      });
      updated++;
    } catch {
      // P2025: no MemberRoster row with this memberNumber — this sheet is
      // a superset of what's already imported; nothing to update onto.
      notInRoster++;
    }
  }

  console.log(`Updated: ${updated}`);
  console.log(`Skipped — no memberNumber in row: ${noMemberNumber}`);
  console.log(`Skipped — memberNumber not found in MemberRoster: ${notInRoster}`);
  console.log(`Skipped — neither field valid for this row: ${nothingValidToUpdate}`);
  if (invalidNationalId > 0) {
    console.log(
      `⚠️  ${invalidNationalId} row(s) had a national ID present but not exactly 13 digits — left unchanged.`
    );
  }
  if (invalidPhone > 0) {
    console.log(
      `⚠️  ${invalidPhone} row(s) had a phone present but not a clean 9/10-digit number — left unchanged.`
    );
  }
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
