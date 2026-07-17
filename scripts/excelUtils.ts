import type ExcelJS from "exceljs";

// Blank-like cell values to normalize to null, beyond genuinely empty
// cells. "nan" (any case) showed up for ~98% of MemberRoster.unitName on
// a real import — the cooperative's spreadsheet had passed through a
// Python/pandas step at some point, and pandas writes empty/NaN cells as
// the literal text "nan" on export unless na_rep='' is set. Left
// unfiltered, that string flows straight into the database as if it were
// a real value, silently defeating any code that checks "is this field
// set" (e.g. resolveForwardTarget in lib/financeAgent.ts treats a
// non-empty string as a real unit name). "-" was the cooperative's own
// placeholder for "not applicable" in these sheets.
const BLANK_TOKENS = new Set(["-", "nan", "n/a", "null", "none"]);

export function cellText(row: ExcelJS.Row, index: number): string | null {
  const value = row.getCell(index).value;
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str) return null;
  return BLANK_TOKENS.has(str.toLowerCase()) ? null : str;
}
