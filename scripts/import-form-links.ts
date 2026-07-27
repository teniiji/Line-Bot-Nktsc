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
// slugifying ชื่อแบบฟอร์ม, since Thai text doesn't slugify cleanly.
//
// Duplicate handling — important, read before changing: ชื่อแบบฟอร์ม is NOT
// unique across the whole sheet by itself. Some names (e.g. "หนังสือแจ้งขอ
// บัตรสมาชิก") legitimately appear once per fund category (สสอค., สส.ชสอ.,
// ...) as genuinely different documents with different download links — the
// dedup key here is (หมวดหมู่, ชื่อแบบฟอร์ม), not name alone, so those are
// kept as separate rows. Only rows sharing BOTH the same category and the
// same name (a real source-sheet duplicate — seen once, for a "หนังสือแจ้ง
// ความประสงค์รับเงินปันผล..." entry where the earlier row's link slug
// mismatched its own label, i.e. pointed at unrelated content) are treated
// as duplicates; the later row in sheet order is kept on the assumption a
// later entry supersedes an earlier one, and the earlier is skipped with a
// warning printed so staff can double-check in the dashboard.
//
// Any name that collides across *different* categories gets its label
// prefixed with the category ("แบบฟอร์ม สสอค. — ...") so the dashboard list
// and the bot's prompt can still tell the two apart.
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

interface Row {
  rowNumber: number;
  seq: string;
  category: string;
  name: string;
  url: string;
}

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

  let skipped = 0;
  let rejected = 0;
  const rows: Row[] = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const seq = cellText(row, SEQ_COLUMN);
    const category = cellText(row, CATEGORY_COLUMN);
    const name = cellText(row, NAME_COLUMN);
    const url = extractUrl(row, LINK_COLUMN);
    if (!seq || !category || !name || !url) {
      skipped++;
      continue;
    }

    const urlError = validateFormLinkUrl(url);
    if (urlError) {
      console.warn(`Row ${rowNumber} rejected ("${name}"): ${urlError}`);
      rejected++;
      continue;
    }

    rows.push({ rowNumber, seq, category, name, url });
  }

  // Same (category, name) more than once = a real source-sheet duplicate —
  // keep the last one seen, skip the rest.
  const byCategoryAndName = new Map<string, Row[]>();
  for (const row of rows) {
    const dupKey = `${row.category}::${row.name}`;
    const list = byCategoryAndName.get(dupKey) ?? [];
    list.push(row);
    byCategoryAndName.set(dupKey, list);
  }

  const kept: Row[] = [];
  let duplicatesSkipped = 0;
  for (const list of byCategoryAndName.values()) {
    kept.push(list[list.length - 1]);
    if (list.length > 1) {
      duplicatesSkipped += list.length - 1;
      const dropped = list.slice(0, -1);
      const winner = list[list.length - 1];
      console.log(
        `⚠️  Duplicate "${winner.category}" / "${winner.name}": keeping row ${winner.rowNumber}, skipping row(s) ${dropped
          .map((r) => r.rowNumber)
          .join(", ")} (same category+name, later row assumed to supersede earlier)`
      );
    }
  }

  // Names that appear under more than one distinct category need the
  // category in the label so the dashboard/bot can tell them apart —
  // otherwise two genuinely different forms would show identical labels.
  const categoriesByName = new Map<string, Set<string>>();
  for (const row of kept) {
    const set = categoriesByName.get(row.name) ?? new Set<string>();
    set.add(row.category);
    categoriesByName.set(row.name, set);
  }

  let imported = 0;
  const entries: { key: string; label: string; url: string }[] = [];
  // Sort by original row order for stable, readable output.
  kept.sort((a, b) => a.rowNumber - b.rowNumber);

  for (const row of kept) {
    const ambiguous = (categoriesByName.get(row.name)?.size ?? 1) > 1;
    const label = ambiguous ? `${row.category} — ${row.name}` : row.name;
    const key = `form_${row.seq.padStart(3, "0")}`;

    await prisma.formLink.upsert({
      where: { key },
      create: { key, label, url: row.url },
      update: { label, url: row.url },
    });
    entries.push({ key, label, url: row.url });
    imported++;
  }

  console.log(
    `\nFormLink: ${imported} imported, ${skipped} skipped (missing data), ${rejected} rejected (validation), ${duplicatesSkipped} duplicate row(s) skipped\n`
  );
  console.log("Imported:");
  for (const e of entries) {
    console.log(`  ${e.key} — ${e.label}`);
  }
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
