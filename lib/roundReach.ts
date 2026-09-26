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

export interface BridgeCandidate {
  deductionResult: string;
  status: string;
}

// Whether a daily-view recording, filed as the deduction category, can be
// written straight into the round's own bookkeeping instead of leaving the
// gap this file otherwise warns about. A member the round has already
// resolved (paid/overpaid/collected) has nothing here for a bank line to
// settle, and writing one anyway would double a real payment.
//
// A member still on รอผลการหัก (awaiting) is let through too: 29375 sent
// ฿31,560 against a แจ้งหัก of ฿31,140 while their unit's deduction result
// had not come back yet, and the daily page's own recording of it
// disappeared — เทียบ Statement went on showing รอผลการหัก with nothing
// paid. This is not inventing a debt: recomputeRoundPayments already judges
// exactly this member (a staff-placed line on someone still awaiting)
// against what was declared rather than leaving them stuck on รอผลการหัก,
// and does not let the figure affect anyone the round later hears payroll
// did collect (collectedStatus ignores amountPaid outright). Bridging is
// what makes that judgment reachable in the first place.
export function canBridgeToRound(member: BridgeCandidate | null): boolean {
  if (!member) return false;
  return (
    (member.deductionResult === "uncollected" && member.status === "unpaid") ||
    (member.deductionResult === "awaiting" && member.status === "awaiting")
  );
}

export interface RealTransferCandidate {
  accountNumber: string;
  amount: number;
  transferredAt: Date | null;
}

// Whether a real, file-uploaded transfer already covers this exact bank
// line — same account, same amount, same calendar day. A bridged payment
// (record route, backfill-bridge route) and its file-uploaded twin read the
// same underlying bank line two different ways: a member's own transfer,
// recorded once by hand from the daily view and once again when staff
// upload the round's own statement covering the same date. Without this
// check both get written, and the round counts the same money twice — one
// real transfer sitting under two rows, one tagged 🔀 and one not, for
// identical amounts on the identical minute. canBridgeToRound alone cannot
// catch this: it only asks whether the member still owes anything, which a
// second, unrelated bank line for the same amount would answer exactly the
// same way.
//
// Day rather than minute: the two paths read the same bank export through
// different parsers, and requiring exact-to-the-second agreement would let
// a real duplicate through on nothing more than rounding.
export function coveredByRealTransfer(
  candidates: RealTransferCandidate[],
  accountNumber: string,
  amount: number,
  transferredAt: Date
): boolean {
  const day = transferredAt.toISOString().slice(0, 10);
  return candidates.some(
    (t) =>
      t.accountNumber === accountNumber &&
      Math.abs(t.amount - amount) < 0.01 &&
      t.transferredAt !== null &&
      t.transferredAt.toISOString().slice(0, 10) === day
  );
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

// After recording one or more deduction payments that canBridgeToRound did
// let through: says what actually happened to the round, in place of the
// warning above wherever the write landed. Bulk recording can mix outcomes
// (some rows still owing on the round, some not), so this names both counts
// rather than only the success — a note that only ever says "done" would
// hide the ones that still need the old advice.
export function recordBridgedRoundNote(
  round: RoundName,
  bridged: number,
  total: number
): string {
  if (bridged >= total) {
    return (
      `บันทึกลงรอบ ${round.label} เป็นชำระ "หักไม่ได้" ให้ด้วยแล้ว` +
      (total > 1 ? ` ทั้ง ${bridged} รายการ` : "") +
      ` — ไม่ต้องอัป Statement ซ้ำ`
    );
  }
  return (
    `บันทึกลงรอบ ${round.label} ให้แล้ว ${bridged} จาก ${total} รายการ — ที่เหลือรอบยังไม่เห็น ` +
    `(อาจไม่ได้ค้างอยู่ในรอบนี้ หรือรอบนับว่าจ่ายไปแล้ว) ถ้าต้องการให้ครบ อัป Statement เข้ารอบที่แท็บ "เทียบ Statement"`
  );
}
