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

// Reads the first worksheet into plain cell arrays, which is all the
// statement/มาไม่ได้ parsers need — they address cells by position, not by
// header name, because neither sheet has a dependable header row.
export async function readFirstSheetRows(file: File): Promise<unknown[][]> {
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

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    // ExcelJS row.values is 1-based with a leading hole; re-index to 0-based
    // so parsers can use the same column numbers as the source sheets.
    for (let col = 1; col <= sheet.columnCount; col += 1) {
      const cell = row.getCell(col);
      const value = cell.value;
      if (value && typeof value === "object" && "result" in value) {
        values.push((value as { result: unknown }).result);
      } else if (value && typeof value === "object" && "text" in value) {
        values.push((value as { text: unknown }).text);
      } else {
        values.push(value);
      }
    }
    rows.push(values);
  });

  return rows;
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
