import { detectSheetColumns, readCell } from "./sheetColumns";
import { readMappedSheet } from "./mappedSheet";

// What a unit's รายการหัก file adds up to, read when it is uploaded on the
// รายการหัก tab — so the table and the LINE message carry the total without
// anyone typing it in. The column is found the same way the เทียบ Statement
// upload finds it (lib/sheetColumns.ts): the ยอดแจ้งหัก column by its
// heading, "สหกรณ์" preferred over a combined "รวม" that also holds สสค.
// Rows with no member number — a unit's own total line at the foot, a blank,
// a note — are left out, so the sheet's own total is never counted twice.

export interface DeductionFileTotal {
  // Null when no amount column could be found; the count still stands.
  amount: number | null;
  memberCount: number;
  // The heading the amount was read from, for staff to check against.
  column: string | null;
}

export function deductionFileTotal(rows: unknown[][]): DeductionFileTotal | null {
  const reading = detectSheetColumns(rows);
  const sheet = readMappedSheet(rows, reading.firstDataRow, reading.mapping);
  if (sheet.rows.length === 0) return null;

  const amounts = sheet.rows.map((r) => r.expectedAmount).filter((a): a is number => a !== null);
  const index = reading.mapping.expected;
  const column =
    index === undefined
      ? null
      : (reading.headerRow !== null ? readCell(rows[reading.headerRow]?.[index]) : "") || null;
  return {
    amount:
      index === undefined || amounts.length === 0
        ? null
        : Math.round(amounts.reduce((sum, a) => sum + a, 0) * 100) / 100,
    memberCount: new Set(sheet.rows.map((r) => r.memberNumber)).size,
    column,
  };
}
