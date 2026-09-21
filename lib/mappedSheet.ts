// Reading a sheet through a mapping a person has confirmed.
//
// Same output as parseMaiDaiSheet — the rows a round is built from — but the
// column positions come from lib/sheetColumns.ts (detected, then corrected by
// whoever uploaded the file) rather than from a fixed contract no real file
// turned out to follow.

import { memberNumberKey } from "./memberNumber";
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
    if (!memberNumber) {
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
    let result: DeductionSheetRow["result"];
    let amountDue = 0;
    if (collectedAmount === null && uncollectedAmount === null) {
      result = "awaiting";
      awaiting += 1;
    } else if (uncollectedAmount !== null && uncollectedAmount > 0) {
      result = "uncollected";
      amountDue = uncollectedAmount;
      uncollected += 1;
    } else {
      result = "collected";
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
