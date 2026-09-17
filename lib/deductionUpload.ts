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
}

export interface UploadPlan {
  // In the sheet, not in the round.
  create: DeductionSheetRow[];
  // In both, and the sheet has something to say about them.
  update: DeductionSheetRow[];
  // In both, but the sheet has no result and the round already has one —
  // kept as they are.
  keptResult: DeductionSheetRow[];
  // In the round, absent from this sheet. Untouched, and counted so the
  // answer can say how much of the round this file did not cover.
  untouched: number;
}

export function planDeductionUpload(
  existing: ExistingMember[],
  incoming: DeductionSheetRow[]
): UploadPlan {
  const have = new Map(existing.map((m) => [m.memberNumber, m.deductionResult]));

  const create: DeductionSheetRow[] = [];
  const update: DeductionSheetRow[] = [];
  const keptResult: DeductionSheetRow[] = [];
  const named = new Set<string>();

  for (const row of incoming) {
    // The same member twice in one file is the file's problem, not the
    // round's: the last mention wins, and the row is counted once.
    named.add(row.memberNumber);
    const held = have.get(row.memberNumber);

    if (held === undefined) {
      create.push(row);
      continue;
    }
    if (row.result === "awaiting" && held !== "awaiting") {
      keptResult.push(row);
      continue;
    }
    update.push(row);
  }

  let untouched = 0;
  for (const member of existing) {
    if (!named.has(member.memberNumber)) untouched += 1;
  }

  return { create, update, keptResult, untouched };
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
