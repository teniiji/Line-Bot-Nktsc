// What one uploaded sheet does to a round that already has a list.
//
// The round used to be built from the results: staff waited for every unit to
// report, somebody assembled one "รวม_ไม่ได้" file, and that file *was* the
// round. Everything before it was invisible — a unit that never replied left
// no trace, because the only record of who was supposed to be deducted was
// the file nobody had finished assembling.
//
// Now the รายการหัก goes in first, so the round knows its own population from
// the start and each unit's reply fills in part of it. That makes a sheet an
// update rather than a replacement, and updates need rules:
//
//   - a member the sheet names and the round has     → update them
//   - a member the sheet names and the round lacks   → add them
//   - a member the round has and the sheet omits     → leave alone
//
// The last one is what lets a single unit's file be uploaded on its own: a
// file covering 40 people must not be read as "the other 1,100 are finished".
//
// And one rule that matters more than it looks: a row with no result never
// overwrites a row that has one. Re-uploading the รายการหัก after results
// have come back is an ordinary thing to do — a correction, a late addition —
// and if "no result yet" won, it would quietly un-answer every unit that had
// already replied.

import type { DeductionSheetRow } from "./statementReconcile";

export interface ExistingMember {
  memberNumber: string;
  deductionResult: string;
  // The หน่วยคุม the round already has for them, if any — see
  // unitsAreAuthoritative below.
  hCode?: string | null;
}

export interface UploadOptions {
  // Whether this sheet is entitled to say which หน่วยคุม a member is in.
  //
  // Only the ไฟล์รวม is: it carries the หน่วยคุม and the รหัสสังกัด in
  // separate columns, so it knows they are different things. A unit's own
  // file has one code column headed "รหัสหน่วย", and what is in it is that
  // unit's internal สังกัด code — 108, 508, 1101 — none of which is one of
  // the cooperative's 64 หน่วยคุม, and none of which the length rule in
  // lib/sheetColumns.ts can tell apart from a หน่วยคุม by looking.
  //
  // So a sheet that does not distinguish the two fills the หน่วยคุม in only
  // where the round has none, and never overwrites one.
  unitsAreAuthoritative?: boolean;
}

export interface UploadPlan {
  // In the sheet, not in the round.
  create: DeductionSheetRow[];
  // In both, and the sheet has something to say about them.
  update: DeductionSheetRow[];
  // In both, but the sheet has no result and the round already has one —
  // kept as they are.
  keptResult: DeductionSheetRow[];
  // Rows of keptResult that the ไฟล์รวม is still entitled to re-code: the
  // rule above is about the *result*, and letting it hold back a correction
  // to the หน่วยคุม left members miscoded precisely because their unit had
  // already answered for them.
  recode: DeductionSheetRow[];
  // In the round, absent from this sheet. Untouched, and counted so the
  // answer can say how much of the round this file did not cover.
  untouched: number;
  // Rows whose หน่วยคุม this sheet was not entitled to change.
  keptUnit: number;
}

export function planDeductionUpload(
  existing: ExistingMember[],
  incoming: DeductionSheetRow[],
  options: UploadOptions = {}
): UploadPlan {
  const have = new Map(existing.map((m) => [m.memberNumber, m]));

  const create: DeductionSheetRow[] = [];
  const update: DeductionSheetRow[] = [];
  const keptResult: DeductionSheetRow[] = [];
  const recode: DeductionSheetRow[] = [];
  const named = new Set<string>();
  let keptUnit = 0;

  for (const row of incoming) {
    // The same member twice in one file is the file's problem, not the
    // round's: the last mention wins, and the row is counted once.
    named.add(row.memberNumber);
    const held = have.get(row.memberNumber);

    if (held === undefined) {
      create.push(row);
      continue;
    }
    if (row.result === "awaiting" && held.deductionResult !== "awaiting") {
      keptResult.push(row);
      if (options.unitsAreAuthoritative) recode.push(row);
      continue;
    }

    if (!options.unitsAreAuthoritative && row.hCode && held.hCode) {
      keptUnit += 1;
      update.push({ ...row, hCode: null });
      continue;
    }
    update.push(row);
  }

  let untouched = 0;
  for (const member of existing) {
    if (!named.has(member.memberNumber)) untouched += 1;
  }

  return { create, update, keptResult, recode, untouched, keptUnit };
}

// Whether this round was built from a รายการหัก — which is what decides
// whether an uploaded result sheet updates the round or replaces it.
//
// A round with anybody still awaiting a result was seeded; so was one where
// the ยอดแจ้งหัก is known, which only the รายการหัก carries. Rounds built the
// old way have neither, and keep the old behaviour exactly: the sheet is the
// round, and re-uploading a corrected one drops whoever fell off it.
export function wasSeeded(
  members: { deductionResult: string; expectedAmount: number | null }[]
): boolean {
  return members.some((m) => m.deductionResult === "awaiting" || m.expectedAmount !== null);
}
