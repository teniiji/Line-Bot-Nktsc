// Saying of one bank line "that is a member paying in", when the transaction
// code did not say so.
//
// lib/statementLines.ts classifies each line from the bank's own code, and a
// code nobody has classified lands in "other": the cooperative's own
// transfers, fees, pension postings — and, until somebody adds the code,
// money a member really did pay in. The daily view offers nothing on an
// "other" line, because recording institutional money under a member's name
// would be far worse than leaving it alone. That was right about the risk and
// wrong about the outcome: ฿10,500 arriving through ถุงเงิน under NMPSDP had
// to wait for a release before anyone could file it.
//
// A person can now say it instead. What they are saying is narrow — this one
// line, not this code — and it goes no further than moving the line into the
// list of money nobody has claimed, where the existing flow asks who paid and
// what for. Nothing is filed as a consequence of the marking itself.
//
// The reverse is offered too, because the only way to find out that a mark
// was wrong is to make it and look.

import { OTHER_CHANNEL, STAFF_CHANNEL } from "./statementLines";

export interface MarkableLine {
  channel: string;
  amount: number;
}

// Whether a person has already said this of the line, which is what makes
// marking it again a no-op rather than an error — two people work the same
// short list, and one of them clicking second has done nothing wrong.
export function isStaffMarked(channel: string): boolean {
  return channel === STAFF_CHANNEL;
}

// Why this line cannot be called a member's payment. Null when it can.
export function markProblem(line: MarkableLine): string | null {
  // Money leaving the account is never a member paying in, whatever anyone
  // believes about the code. The same rule classifyChannel applies, restated
  // here because this path bypasses it by design.
  if (line.amount < 0) {
    return "รายการนี้เป็นเงินที่ออกจากบัญชี ไม่ใช่เงินที่สมาชิกโอนเข้ามา";
  }
  if (line.amount === 0) {
    return "รายการนี้ยอดเป็นศูนย์ จึงบันทึกเป็นเงินที่สมาชิกโอนเข้ามาไม่ได้";
  }
  // Already counted as a member's payment by the bank's own code. Nothing to
  // do, and a request saying otherwise is a page that has gone stale rather
  // than a decision anyone is making.
  if (line.channel !== OTHER_CHANNEL && !isStaffMarked(line.channel)) {
    return "รายการนี้นับเป็นเงินสมาชิกอยู่แล้วจากรหัสของธนาคาร";
  }
  return null;
}

// Why the mark cannot be taken back. Null when it can.
//
// recordedCount is how many transactions point at this line. One is the
// ordinary case — somebody marked the line, then filed the payment — and it
// is exactly the case that must not be undone from here: the transaction
// would go on existing while its bank line went back to counting as
// institutional money, so the day's figures would disagree with themselves
// and nothing on screen would say why.
export function unmarkProblem(line: { channel: string }, recordedCount: number): string | null {
  if (!isStaffMarked(line.channel)) {
    return "ย้อนได้เฉพาะรายการที่เจ้าหน้าที่ระบุเองว่าเป็นเงินสมาชิก";
  }
  if (recordedCount > 0) {
    return (
      "เงินก้อนนี้ถูกบันทึกเป็นรายการของสมาชิกไปแล้ว — " +
      'ถ้าจะย้อน ให้ลบรายการนั้นที่แท็บ "รายการ" ก่อน'
    );
  }
  return null;
}
