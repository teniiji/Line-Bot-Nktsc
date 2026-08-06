// One-off/occasional import: backfills LineUser.nickname from the
// "Nickname (LINE OA)" column of the cooperative's "สมาชิก_LINE_OA" sheet
// (the same master database used by import-national-id-phone.ts) — this
// is the label staff already maintain per-member in that spreadsheet
// (typically "ชื่อ หน่วยงาน เลขสมาชิก"), separate from and often more
// useful than the raw LINE profile display name.
//
// Deliberately narrow, same as import-national-id-phone.ts: ONLY ever
// updates nickname on a LineUser row that already exists (i.e. someone
// who has actually messaged the bot at least once — the "สมาชิก LINE"
// dashboard tab is scoped to exactly that). Never creates a new LineUser
// row for someone in this sheet who hasn't messaged the bot; that column
// is reported separately below so staff know it's expected, not a bug.
//
// Rows are matched on เลขสมาชิก (column A), NOT on the sheet's
// LINE_UserID column. A LINE userId is scoped to the OA channel that
// issued it, so those values all went stale when the cooperative moved to
// a new LINE OA — matching on them made this script quietly update
// nothing at all while still reporting success. A member number survives
// an OA change, and LineUser.memberNumber is filled in as soon as the
// member identifies themselves (submit_member_info), which is the same
// population this script is scoped to anyway.
//
// Column note: this sheet's own "Nickname (LINE OA)" is a completely
// different thing from the per-friend name staff can set inside LINE
// Official Account Manager (chat.line.biz) — that one has no API and
// can't be read by any script; this sheet's column is just this
// spreadsheet's own record of what staff want the nickname to be.
//
// Never commit the source spreadsheet itself (it has real members' LINE
// user IDs and other identifying data) to this repo.
//
// Usage: npx tsx scripts/import-line-nicknames.ts <path-to-xlsx>

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { cellText as cell } from "./excelUtils";

const prisma = new PrismaClient();

const MEMBER_SHEET_NAME = "สมาชิก_LINE_OA";
const MEMBER_NUMBER_COLUMN = 1; // A: เลขสมาชิก
const NICKNAME_COLUMN = 5; // E: "Nickname (LINE OA)"

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-line-nicknames.ts <path-to-xlsx>");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(MEMBER_SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${MEMBER_SHEET_NAME}" not found.`);
    process.exit(1);
  }

  const header = sheet.getRow(1);
  console.log(
    `Header check — Col A: "${header.getCell(MEMBER_NUMBER_COLUMN).value}", ` +
      `Col E: "${header.getCell(NICKNAME_COLUMN).value}"\n`
  );

  let updated = 0;
  let noMemberNumber = 0;
  let noNickname = 0;
  let notIdentifiedYet = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const memberNumber = cell(row, MEMBER_NUMBER_COLUMN);
    if (!memberNumber) {
      noMemberNumber++;
      continue;
    }

    const nickname = cell(row, NICKNAME_COLUMN);
    if (!nickname) {
      noNickname++;
      continue;
    }

    // updateMany rather than update: memberNumber isn't unique on LineUser
    // (it's only set once the member identifies), so there's no unique
    // where-clause to target — and a member who re-added the bot from a
    // second LINE account would legitimately have more than one row.
    const { count } = await prisma.lineUser.updateMany({
      where: { memberNumber },
      data: { nickname },
    });
    if (count > 0) {
      updated += count;
    } else {
      // No LineUser carries this member number yet: either they've never
      // messaged the bot, or they have but haven't identified themselves
      // during a transaction. Expected for most of this sheet, not an error.
      notIdentifiedYet++;
    }
  }

  console.log(`Updated: ${updated}`);
  console.log(`Skipped — no เลขสมาชิก in row: ${noMemberNumber}`);
  console.log(`Skipped — no nickname in row: ${noNickname}`);
  console.log(`Skipped — no LINE account identified with this member number yet: ${notIdentifiedYet}`);
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
