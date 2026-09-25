// Reading a sheet through a mapping a person has confirmed.
//
// Same output as parseMaiDaiSheet — the rows a round is built from — but the
// column positions come from lib/sheetColumns.ts (detected, then corrected by
// whoever uploaded the file) rather than from a fixed contract no real file
// turned out to follow.

import { isPlausibleMemberNumber, memberNumberKey } from "./memberNumber";
import { normalizeAccountNumber } from "./statementReconcile";
import type { DeductionSheetRow } from "./statementReconcile";
import { readCell, readNumber, type SheetMapping } from "./sheetColumns";

export interface MappedSheet {
  rows: DeductionSheetRow[];
  // Rows with no member number at all: blank lines, totals at the foot of a
  // unit's sheet, a stray note. Counted rather than silently dropped, so an
  // import that read half a file says so.
  skipped: number;
  awaiting: number;
  collected: number;
  uncollected: number;
}

// Whether the file, as mapped, can say anything about results at all. A
// รายการหัก has neither result column, and that is not a fault — it is the
// list on its way out, and every row it carries is awaiting one.
export function mappingHasResults(mapping: SheetMapping): boolean {
  return mapping.collected !== undefined || mapping.uncollected !== undefined;
}

export function readMappedSheet(
  rows: unknown[][],
  firstDataRow: number,
  mapping: SheetMapping
): MappedSheet {
  const at = (row: unknown[], field: keyof SheetMapping): unknown => {
    const index = mapping[field];
    return index === undefined ? null : row?.[index];
  };

  const out: DeductionSheetRow[] = [];
  let skipped = 0;
  let awaiting = 0;
  let collected = 0;
  let uncollected = 0;

  for (const row of rows.slice(firstDataRow)) {
    if (!row) continue;
    const memberNumber = memberNumberKey(readCell(at(row, "memberNumber")));
    // A total row's own label — "รวม" and the like — can land in whichever
    // column this file's memberNumber turned out to be, and passes
    // memberNumberKey unchanged: it is non-empty text, just never a member.
    // See lib/memberNumber.ts.
    if (!memberNumber || !isPlausibleMemberNumber(memberNumber)) {
      // Only count a row that had something in it; trailing blanks are not
      // rows anybody left out.
      if (row.some((cell) => readCell(cell))) skipped += 1;
      continue;
    }

    const expectedAmount = readNumber(at(row, "expected"));
    const collectedAmount = readNumber(at(row, "collected"));
    const uncollectedAmount = readNumber(at(row, "uncollected"));

    // The three states, from the two result columns. A file with neither
    // column — the รายการหัก — leaves every row awaiting, which is what it
    // is: a list of deductions asked for, before anyone has answered.
    //
    // A blank in either result column the file does have is awaiting too,
    // not a zero: the cooperative's rule is that a unit which has reported
    // fills both columns (0 where nothing applies), so a row with one of them
    // left empty has not been answered in full yet. A column the mapping
    // leaves out is not blank, just absent, and says nothing either way.
    const collectedBlank = mapping.collected !== undefined && collectedAmount === null;
    const uncollectedBlank = mapping.uncollected !== undefined && uncollectedAmount === null;
    let result: DeductionSheetRow["result"];
    let amountDue = 0;
    if ((collectedAmount === null && uncollectedAmount === null) || collectedBlank || uncollectedBlank) {
      result = "awaiting";
      awaiting += 1;
    } else if (uncollectedAmount !== null && uncollectedAmount > 0) {
      result = "uncollected";
      amountDue = uncollectedAmount;
      uncollected += 1;
    } else {
      result = "collected";
      // Below 0 is หักเกิน — payroll took more than was asked. Kept as the
      // sheet has it so a unit's total matches the sheet's own total row.
      if (uncollectedAmount !== null && uncollectedAmount < 0) amountDue = uncollectedAmount;
      collected += 1;
    }

    out.push({
      memberNumber,
      name: readCell(at(row, "name")),
      unitName: readCell(at(row, "unitName")) || null,
      unitCode: readCell(at(row, "unitCode")) || null,
      hCode: readCell(at(row, "hCode")) || null,
      note: null,
      accountNumber: normalizeAccountNumber(readCell(at(row, "accountNumber"))),
      expectedAmount,
      amountDue,
      result,
    });
  }

  return { rows: out, skipped, awaiting, collected, uncollected };
}
