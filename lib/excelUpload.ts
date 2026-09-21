import ExcelJS from "exceljs";
import { looksLikeLegacyXls, looksLikeZip, repairZip, toArrayBuffer } from "./xlsxRepair";
import { looksLikeHtml, parseHtmlTableRows } from "./htmlTable";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// The bank exports statements as .xls, but those files are ZIP-based
// (xlsx content behind an old extension) and ExcelJS reads them fine — so
// the extension is accepted and the parse itself decides. A genuinely old
// BIFF .xls throws, and the caller turns that into a message telling staff
// to re-save it as .xlsx, which is a step they already do locally.
export const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];

export function checkUploadedFile(file: unknown): { file: File } | { error: string } {
  if (!(file instanceof File)) return { error: "ต้องแนบไฟล์" };

  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return { error: "รองรับเฉพาะไฟล์ Excel (.xlsx / .xls)" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `ไฟล์ใหญ่เกิน ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB — ตรวจสอบว่าแนบไฟล์ถูกตัวไหม`,
    };
  }
  return { file };
}

// Some of the bank's exports have no central directory — the zip index that
// tells a reader where the entries are. Excel silently repairs those on open,
// so staff never noticed; ExcelJS refuses them outright. Rebuilding the index
// from the entries that are still in the file is the same repair, and it is
// what lets the .xls files that used to work keep working.
async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
    return workbook;
  } catch (err) {
    const data = Buffer.from(buffer);
    if (looksLikeLegacyXls(data)) throw new UnreadableFileError(LEGACY_XLS_ERROR);
    if (!looksLikeZip(data)) throw err;

    const repaired = new ExcelJS.Workbook();
    // Errors from here are not worth distinguishing: the file starts like a
    // zip but neither reads nor rebuilds, so it is damaged beyond a guess.
    await repaired.xlsx.load(toArrayBuffer(repairZip(data)));
    return repaired;
  }
}

// What a workbook holds, so an upload can be pointed at the right sheet.
//
// The first sheet is not always the one with the answers: the unit files
// carry a "หน่วย" sheet beside a "สรุป", and some carry the ผลการหัก on a
// third. Reading sheet one and reporting no amounts made that look like a
// broken file rather than the wrong page of a good one.
export interface SheetChoice {
  index: number;
  name: string;
  rows: number;
}

export async function listSheets(file: File): Promise<SheetChoice[]> {
  const buffer = await file.arrayBuffer();
  const data = Buffer.from(buffer);
  // An HTML table pretending to be .xls has exactly one sheet and no name
  // worth showing.
  if (looksLikeHtml(data)) {
    return [{ index: 0, name: "ตารางในไฟล์", rows: parseHtmlTableRows(data.toString("utf8")).length }];
  }

  const workbook = await loadWorkbook(buffer);
  return workbook.worksheets.map((sheet, index) => ({
    index,
    name: sheet.name,
    rows: sheet.rowCount,
  }));
}

// Reads one worksheet into plain cell arrays. The parsers address cells by
// position, not by header name, because not every sheet staff upload has a
// dependable header row.
export async function readFirstSheetRows(file: File, sheetIndex = 0): Promise<unknown[][]> {
  const buffer = await file.arrayBuffer();

  // Checked before handing the bytes to a spreadsheet reader, because the
  // bank's web export writes an HTML table and calls it .xls. Excel opens
  // those, so nothing about downloading one suggests it is not a spreadsheet
  // — but no spreadsheet reader will touch it, and the failure it produces
  // looks exactly like a corrupt file.
  const data = Buffer.from(buffer);
  if (looksLikeHtml(data)) {
    return parseHtmlTableRows(data.toString("utf8"));
  }

  const workbook = await loadWorkbook(buffer);

  const sheet = workbook.worksheets[sheetIndex] ?? workbook.worksheets[0];
  if (!sheet) return [];

  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    // ExcelJS row.values is 1-based with a leading hole; re-index to 0-based
    // so parsers can use the same column numbers as the source sheets.
    for (let col = 1; col <= sheet.columnCount; col += 1) {
      values.push(readCellValue(sheet, row.getCell(col)));
    }
    rows.push(values);
  });

  return rows;
}

// One cell's value, with formulas resolved.
//
// The unit sheets compute their own ยอดหักไม่ได้ — "=F5-G5", filled down the
// column as a shared formula — and a cell like that arrives as
// { formula: "F5-G5" } or { sharedFormula: "H5" } with no value attached at
// all. Read as "nothing", a row whose shortfall the file worked out itself
// became a member who owed nothing: money quietly leaving the round.
//
// So the number is taken from the cell's own result where the file cached
// one, and otherwise worked out from the cells the formula names. Only a
// single subtraction or addition of two cells is evaluated — that is what
// these sheets contain, and a spreadsheet engine is not what this needs to
// become.
const SIMPLE_ARITHMETIC = /^\s*([A-Z]+[0-9]+)\s*([-+])\s*([A-Z]+[0-9]+)\s*$/;

function plainValue(value: unknown): unknown {
  if (value && typeof value === "object") {
    if ("result" in value) return (value as { result: unknown }).result;
    if ("text" in value) return (value as { text: unknown }).text;
    if (Array.isArray((value as { richText?: unknown[] }).richText)) {
      return (value as { richText: { text: string }[] }).richText
        .map((part) => part.text)
        .join("");
    }
  }
  return value;
}

function numberAt(sheet: ExcelJS.Worksheet, address: string): number | null {
  const plain = plainValue(sheet.getCell(address).value);
  if (typeof plain === "number") return Number.isFinite(plain) ? plain : null;
  if (typeof plain === "string" && plain.trim()) {
    const num = Number(plain.replace(/,/g, ""));
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function readCellValue(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell): unknown {
  // Not a formula: whatever is in it, unwrapped.
  if (cell.formula === undefined) return plainValue(cell.value);

  // Computed from the file's current numbers in preference to a cached
  // result, which can be left over from before somebody edited the cells it
  // was computed from. ExcelJS translates a shared formula to the row it is
  // used on, so "=F5-G5" filled down reads as "F6-G6" here.
  const match = SIMPLE_ARITHMETIC.exec(cell.formula);
  if (match) {
    const left = numberAt(sheet, match[1]);
    const right = numberAt(sheet, match[3]);
    if (left !== null && right !== null) {
      return match[2] === "-" ? left - right : left + right;
    }
  }

  return cell.result ?? null;
}

export const UNREADABLE_FILE_ERROR =
  "อ่านไฟล์นี้ไม่ได้ — ไฟล์อาจเสียหาย ให้เปิดใน Excel แล้ว Save As เป็น .xlsx ก่อนอัปโหลด";

// Kept apart from the message above because the two mean different things to
// whoever is uploading: this one is a file Excel saved in the format it used
// before 2007, and re-saving really is the only way out of it.
export const LEGACY_XLS_ERROR =
  "ไฟล์นี้เป็น Excel รุ่นเก่า (.xls แบบดั้งเดิม) — ให้เปิดใน Excel แล้ว Save As เป็น .xlsx ก่อนอัปโหลด";

// Carries the message staff should see, so the routes don't have to work out
// which of the two applies from an ExcelJS stack trace.
export class UnreadableFileError extends Error {}

export function describeReadError(err: unknown): string {
  return err instanceof UnreadableFileError ? err.message : UNREADABLE_FILE_ERROR;
}
