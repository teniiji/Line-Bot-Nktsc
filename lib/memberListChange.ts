// Deciding whether a member-list upload is a correction or a mistake.
//
// Re-uploading the round's "รวม_ไม่ได้" sheet replaces the list rather than
// merging into it, and that is deliberate: the sheet is regenerated whenever
// the หักไม่ได้ analysis is re-run, and merging would leave members who
// dropped off the corrected sheet sitting in the round forever.
//
// The cost of that choice is that uploading the wrong file is silent and
// total. A round of 1,200 members replaced by one unit's own 40-row file
// looks exactly like a successful upload — the same green notice, a smaller
// number in it — and the only way back is to find the right file and upload
// again, having lost the account numbers staff had bound by hand in the
// meantime.
//
// So a replacement that takes away most of the round stops and asks. It does
// not refuse: a genuine correction can be that large, and the person doing it
// knows which file they picked. It only makes sure the question was asked
// out loud, with the numbers and the disappearing units in front of them —
// "the file you chose covers 1 unit, this round has 34" is the sentence that
// tells the two cases apart.

export interface MemberListEntry {
  memberNumber: string;
  unitName: string | null;
}

export interface MemberListChange {
  existingCount: number;
  incomingCount: number;
  // Members on the round now that the new sheet does not mention at all.
  removedCount: number;
  // Units that disappear entirely — the giveaway when somebody uploads one
  // unit's file over the combined one.
  removedUnits: string[];
  // Units the new sheet brings that the round has never had.
  addedUnits: string[];
}

// Below this, asking is noise: a round still being set up changes shape
// constantly, and nobody loses a day's work over four rows.
const MIN_REMOVED_TO_ASK = 5;

export function summarizeMemberListChange(
  existing: MemberListEntry[],
  incoming: MemberListEntry[]
): MemberListChange {
  const incomingNumbers = new Set(incoming.map((row) => row.memberNumber));
  const removed = existing.filter((row) => !incomingNumbers.has(row.memberNumber));

  const unitsOf = (rows: MemberListEntry[]) =>
    new Set(rows.map((row) => row.unitName).filter((name): name is string => Boolean(name)));

  const existingUnits = unitsOf(existing);
  const incomingUnits = unitsOf(incoming);

  return {
    existingCount: existing.length,
    incomingCount: incoming.length,
    removedCount: removed.length,
    removedUnits: [...existingUnits].filter((unit) => !incomingUnits.has(unit)).sort(),
    addedUnits: [...incomingUnits].filter((unit) => !existingUnits.has(unit)).sort(),
  };
}

// Ask when the upload would take away more than half of the round. Half is
// the line because below it the sheet is plainly still the same round's list
// with corrections; above it, the new file is a different population, and
// that is either a deliberate redo or the wrong file — which is exactly the
// question only the person at the keyboard can answer.
export function needsShrinkConfirmation(change: MemberListChange): boolean {
  if (change.existingCount === 0) return false;
  if (change.removedCount < MIN_REMOVED_TO_ASK) return false;
  return change.removedCount * 2 > change.existingCount;
}

// What staff are asked, in the words that make the two cases distinguishable.
// Written here rather than in the route because a Next.js route file may only
// export request handlers, and the same sentence has to be testable.
export function describeShrink(change: MemberListChange): string {
  const parts = [
    `ไฟล์นี้จะแทนที่รายชื่อทั้งรอบ: เดิม ${change.existingCount} คน → เหลือ ${change.incomingCount} คน ` +
      `(หายไป ${change.removedCount} คน)`,
  ];

  if (change.removedUnits.length > 0) {
    const shown = change.removedUnits.slice(0, 5).join(", ");
    const more =
      change.removedUnits.length > 5 ? ` และอีก ${change.removedUnits.length - 5} หน่วย` : "";
    parts.push(`หน่วยงานที่จะหายไปทั้งหน่วย (${change.removedUnits.length}): ${shown}${more}`);
  }

  if (change.addedUnits.length > 0) {
    parts.push(`หน่วยงานที่เพิ่มเข้ามา (${change.addedUnits.length}): ${change.addedUnits.slice(0, 5).join(", ")}`);
  }

  parts.push(
    "ถ้านี่คือไฟล์รวมที่ประมวลผลใหม่ ให้ยืนยันได้เลย — " +
      "แต่ถ้าเผลอเลือกไฟล์ของหน่วยงานเดียว รายชื่อที่เหลือจะหายทั้งหมด (เลขบัญชีที่ผูกไว้เองก็หายด้วย)"
  );

  return parts.join("\n");
}
