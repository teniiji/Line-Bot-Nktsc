// Taking a ผลการหัก file back out of a round.
//
// A results upload writes each named member's หักได้/หักไม่ได้ and ยอด
// straight onto the round. With nothing kept about which file did what,
// "this was the wrong file" had no answer but uploading a right one over it
// — and a file of the wrong unit, or the wrong month, has no right one.
//
// So each upload keeps what it changed: who, what they were before, what it
// made them. Undoing puts them back, but only where the file's own result is
// still standing — a member a later file (or a person) has changed since is
// left alone and reported, because undoing an old file must not erase newer
// work. A member the file added is removed only while no money is tied to
// them.

export type ResultState = "awaiting" | "collected" | "uncollected" | string;

export interface UploadChange {
  memberNumber: string;
  // Null when the file added the member to the round.
  before: { deductionResult: ResultState; amountDue: number; expectedAmount: number | null } | null;
  after: { deductionResult: ResultState; amountDue: number };
}

const SAME = 0.005;

export function recordedChanges(
  roster: { memberNumber: string; deductionResult: string; amountDue: number; expectedAmount: number | null }[],
  plan: {
    create: { memberNumber: string; result: string; amountDue: number }[];
    update: { memberNumber: string; result: string; amountDue: number }[];
  }
): UploadChange[] {
  const had = new Map(roster.map((m) => [m.memberNumber, m]));
  const changes: UploadChange[] = [];
  for (const row of plan.update) {
    const was = had.get(row.memberNumber);
    if (!was) continue;
    // Nothing moved: nothing to put back.
    if (was.deductionResult === row.result && Math.abs(was.amountDue - row.amountDue) < SAME) continue;
    changes.push({
      memberNumber: row.memberNumber,
      before: { deductionResult: was.deductionResult, amountDue: was.amountDue, expectedAmount: was.expectedAmount },
      after: { deductionResult: row.result, amountDue: row.amountDue },
    });
  }
  for (const row of plan.create) {
    changes.push({ memberNumber: row.memberNumber, before: null, after: { deductionResult: row.result, amountDue: row.amountDue } });
  }
  return changes;
}

export interface CurrentMember {
  deductionResult: string;
  amountDue: number;
  amountPaid: number;
  transfers: number;
}

export interface UndoPlan {
  restore: { memberNumber: string; before: NonNullable<UploadChange["before"]> }[];
  remove: string[];
  skipped: { memberNumber: string; reason: string }[];
}

export function planUndo(changes: UploadChange[], current: Map<string, CurrentMember>): UndoPlan {
  const plan: UndoPlan = { restore: [], remove: [], skipped: [] };
  for (const change of changes) {
    const now = current.get(change.memberNumber);
    if (!now) {
      plan.skipped.push({ memberNumber: change.memberNumber, reason: "ไม่อยู่ในรอบแล้ว" });
      continue;
    }
    if (now.deductionResult !== change.after.deductionResult || Math.abs(now.amountDue - change.after.amountDue) >= SAME) {
      plan.skipped.push({ memberNumber: change.memberNumber, reason: "ถูกไฟล์อื่นหรือเจ้าหน้าที่แก้ไปแล้ว" });
      continue;
    }
    if (change.before === null) {
      if (now.amountPaid > 0 || now.transfers > 0) {
        plan.skipped.push({ memberNumber: change.memberNumber, reason: "มีเงินโอนผูกอยู่ จึงไม่ลบออกจากรอบ" });
      } else {
        plan.remove.push(change.memberNumber);
      }
      continue;
    }
    plan.restore.push({ memberNumber: change.memberNumber, before: change.before });
  }
  return plan;
}

// The changes a stored upload carries, or null for one recorded before they
// were kept (or a file that is not a results upload) — which can only be
// taken off the list, not undone.
export function readChanges(value: unknown): UploadChange[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (c): c is UploadChange =>
      !!c && typeof c.memberNumber === "string" && typeof c.after?.deductionResult === "string"
  );
}
