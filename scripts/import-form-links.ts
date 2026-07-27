// One-off import: reads the cooperative's scraped "แบบฟอร์มสหกรณ์" sheet
// (form name + download link per row, grouped by category) and upserts it
// into FormLink so the bot can answer "ขอแบบฟอร์ม..." with a direct link
// instead of the "contact the office" fallback — see lib/formLinks.ts.
//
// Sheet: "แบบฟอร์มสหกรณ์" — columns (1-indexed): 1 ลำดับ, 2 หมวดหมู่,
// 3 ชื่อแบบฟอร์ม, 4 ประเภทไฟล์, 5 ขนาดไฟล์, 6 ลิงก์ดาวน์โหลด (a rich-text
// hyperlink cell, not a plain string — see extractUrl below). Header row is
// row 1, data starts row 2.
//
// key is derived from the row's ลำดับ (e.g. "form_002") rather than
// slugifying ชื่อแบบฟอร์ม, since Thai text doesn't slugify cleanly and a
// couple of source rows share an identical ชื่อแบบฟอร์ม (the source site
// itself has duplicate-looking entries) — using the row number keeps every
// key unique without guessing which duplicate is "canonical".
//
// Usage: npx tsx scripts/import-form-links.ts <path-to-xlsx>

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { validateFormLinkUrl } from "../lib/formLinkValidation";

const prisma = new PrismaClient();
const SHEET_NAME = "แบบฟอร์มสหกรณ์";
const SEQ_COLUMN = 1; // column A: ลำดับ
const CATEGORY_COLUMN = 2; // column B: หมวดหมู่
const NAME_COLUMN = 3; // column C: ชื่อแบบฟอร์ม
const LINK_COLUMN = 6; // column F: ลิงก์ดาวน์โหลด

function extractUrl(row: ExcelJS.Row, index: number): string | null {
  const value = row.getCell(index).value as unknown;
  if (value && typeof value === "object" && "hyperlink" in value) {
    return String((value as { hyperlink: string }).hyperlink).trim() || null;
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function cellText(row: ExcelJS.Row, index: number): string | null {
  const value = row.getCell(index).value;
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str || null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-form-links.ts <path-to-xlsx>");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${SHEET_NAME}" not found in ${filePath}.`);
    process.exit(1);
  }

  const header = sheet.getRow(1);
  console.log(
    `Header check — Col B: "${header.getCell(CATEGORY_COLUMN).value}", ` +
      `Col C: "${header.getCell(NAME_COLUMN).value}", ` +
      `Col F: "${header.getCell(LINK_COLUMN).value}"\n`
  );

  let imported = 0;
  let skipped = 0;
  let rejected = 0;
  const seenLabels = new Map<string, number>();
  const entries: { key: string; label: string; url: string }[] = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const seq = cellText(row, SEQ_COLUMN);
    const name = cellText(row, NAME_COLUMN);
    const url = extractUrl(row, LINK_COLUMN);
    if (!seq || !name || !url) {
      skipped++;
      continue;
    }

    const urlError = validateFormLinkUrl(url);
    if (urlError) {
      console.warn(`Row ${rowNumber} rejected ("${name}"): ${urlError}`);
      rejected++;
      continue;
    }

    // Disambiguate duplicate ชื่อแบบฟอร์ม values from the source sheet (a
    // couple of rows share an identical name) so the label alone still
    // tells the label apart in the dashboard list and the bot's prompt.
    const seenCount = seenLabels.get(name) ?? 0;
    seenLabels.set(name, seenCount + 1);
    const label = seenCount === 0 ? name : `${name} (${seenCount + 1})`;

    const key = `form_${seq.padStart(3, "0")}`;
    await prisma.formLink.upsert({
      where: { key },
      create: { key, label, url },
      update: { label, url },
    });
    entries.push({ key, label, url });
    imported++;
  }

  console.log(`FormLink: ${imported} imported, ${skipped} skipped (missing data), ${rejected} rejected (validation)\n`);
  console.log("Imported:");
  for (const e of entries) {
    console.log(`  ${e.key} — ${e.label}`);
  }

  const duplicateLabels = [...seenLabels.entries()].filter(([, count]) => count > 1);
  if (duplicateLabels.length > 0) {
    console.log(
      `\n⚠️  ${duplicateLabels.length} label(s) appeared more than once in the source sheet (kept both, suffixed "(2)" etc.) — review and remove the stale one from the dashboard if it's an outdated duplicate:`
    );
    for (const [label, count] of duplicateLabels) {
      console.log(`  - "${label}" (${count} rows)`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
