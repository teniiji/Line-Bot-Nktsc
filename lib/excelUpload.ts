import ExcelJS from "exceljs";

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

// Reads the first worksheet into plain cell arrays, which is all the
// statement/มาไม่ได้ parsers need — they address cells by position, not by
// header name, because neither sheet has a dependable header row.
export async function readFirstSheetRows(file: File): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

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
  "อ่านไฟล์นี้ไม่ได้ — ถ้าเป็นไฟล์ .xls รุ่นเก่า ให้เปิดใน Excel แล้ว Save As เป็น .xlsx ก่อนอัปโหลด";
