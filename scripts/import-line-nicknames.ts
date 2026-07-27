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
const LINE_USER_ID_COLUMN = 4; // D
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
    `Header check — Col D: "${header.getCell(LINE_USER_ID_COLUMN).value}", ` +
      `Col E: "${header.getCell(NICKNAME_COLUMN).value}"\n`
  );

  let updated = 0;
  let noLineUserId = 0;
  let noNickname = 0;
  let notMessagedBotYet = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const lineUserId = cell(row, LINE_USER_ID_COLUMN);
    if (!lineUserId) {
      noLineUserId++;
      continue;
    }

    const nickname = cell(row, NICKNAME_COLUMN);
    if (!nickname) {
      noNickname++;
      continue;
    }

    try {
      await prisma.lineUser.update({
        where: { id: lineUserId },
        data: { nickname },
      });
      updated++;
    } catch {
      // P2025: no LineUser row with this id — this person hasn't
      // messaged the bot yet, so there's nothing to attach a nickname
      // to. Expected for most of this sheet, not an error.
      notMessagedBotYet++;
    }
  }

  console.log(`Updated: ${updated}`);
  console.log(`Skipped — no LINE_UserID in row: ${noLineUserId}`);
  console.log(`Skipped — no nickname in row: ${noNickname}`);
  console.log(`Skipped — hasn't messaged the bot yet (no LineUser row): ${notMessagedBotYet}`);
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
