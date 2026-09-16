// What the daily page does, and does not, reach.
//
// The two tabs read the same statement two ways. เทียบ Statement builds a
// round's payments from StatementTransfer, which only the round's own upload
// writes; เงินเข้าประจำวัน works from StatementLine, which either upload
// writes. Nothing on the daily page can put money into a round.
//
// That is the right shape — a round is a month's reconciliation, not a
// running total of everything anybody typed — but it is invisible, and the
// two actions on the daily page both look like they ought to reach it:
//
//   ระบุเจ้าของ  — does reach it, but only where the round already holds that
//                 account's transfers, because all it can do is re-match rows
//                 that exist. Where the statement never went into a round,
//                 there is nothing to re-match and the binding changes
//                 nothing there.
//   บันทึกรายการ — never reaches it. amountPaid is summed from
//                 StatementTransfer and has never read a transaction.
//
// So both say so, once, at the moment the gap opens.

export interface RoundName {
  label: string;
}

// After binding an account: said when no round moved.
//
// Silent when a round did pick it up (the count says so on its own) and when
// there are no rounds at all — advising somebody to upload a statement into a
// round they have not created is not advice.
export function bindMissedRoundNote(
  matchedRounds: number,
  round: RoundName | null
): string | null {
  if (matchedRounds > 0 || !round) return null;
  return (
    `ยังไม่มีรอบเก็บไม่ได้รอบไหนเห็นเงินก้อนนี้ — ถ้าเป็นเงินจ่ายค่าเก็บไม่ได้ ` +
    `ต้องอัป Statement เข้ารอบ ${round.label} ที่แท็บ "เทียบ Statement" ด้วย ` +
    `(อัปที่แท็บนี้เข้าเฉพาะหน้าเงินเข้าประจำวัน)`
  );
}

// After recording a payment: said only when it was filed as a deduction
// payment, which is the one category a round is keeping score of.
//
// Every other category — ฝากเงิน, ซื้อหุ้น, ชำระหนี้ — has nothing to do with
// a round, and saying this on those would be a warning that fires on almost
// every recording and means nothing on nearly all of them.
export function recordMissedRoundNote(
  category: string,
  deductionCategory: string,
  round: RoundName | null
): string | null {
  if (category !== deductionCategory || !round) return null;
  return (
    `หมายเหตุ: รอบ ${round.label} จะยังขึ้นว่าค้างอยู่ — ` +
    `ยอด "โอนมาแล้ว" ของรอบนับจาก Statement ที่อัปเข้ารอบเท่านั้น ไม่ได้นับรายการที่บันทึกด้วยมือ ` +
    `ถ้าต้องการให้รอบขึ้นว่าจ่ายแล้ว ให้อัป Statement เข้ารอบที่แท็บ "เทียบ Statement"`
  );
}
