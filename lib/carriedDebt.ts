// ชำระข้ามเดือน — what a member still owes a round after it is closed.
//
// The cooperative cuts each month's หักไม่ได้ off at month end and sets up
// what is still unpaid as a debt of its own, paid off separately from the
// next month's round. Before this, a round never ended: a payment made in
// September for an August debt landed in whichever round its statement was
// uploaded into, and read as September's money.
//
// Pure rules only, so the arithmetic staff chase people over can be tested
// directly. The database side is lib/carriedDebtStore.ts.

import { calcPaymentStatus } from "./statementReconcile";

// Two amounts are the same payment once they are within a satang of each
// other — the tolerance used everywhere else money is compared here.
const EPSILON = 0.01;

// Every route that could change a round's money refuses once it is closed:
// the carried debts were taken from its figures at that moment, and a late
// upload moving them would leave the two tabs telling different stories.
export const ROUND_CLOSED_ERROR =
  'รอบนี้ปิดแล้ว — ยอดที่ยังค้างย้ายไปอยู่ที่แถบ "ชำระข้ามเดือน" แล้ว ถ้าจำเป็นต้องแก้ ให้กด "เปิดรอบอีกครั้ง" ก่อน';

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * What a transfer still counts toward its own round: the bank's amount less
 * whatever staff moved from it to a carried debt.
 */
export function countedAmount(transfer: { amount: number; carriedAmount: number }): number {
  return round2(transfer.amount - transfer.carriedAmount);
}

export interface ClosingMember {
  deductionResult: string;
  status: string;
  amountDue: number;
  amountPaid: number;
}

/**
 * What a member carries out of a round when it closes, or 0 when they carry
 * nothing.
 *
 * Only a member the round actually chased and who is still short: a unit
 * that never reported (awaiting) has not said anybody owes anything, and a
 * member payroll collected from (collected) never did.
 */
export function outstandingAtClose(member: ClosingMember): number {
  if (member.deductionResult !== "uncollected") return 0;
  if (member.status !== "unpaid") return 0;
  const outstanding = round2(member.amountDue - member.amountPaid);
  return outstanding > EPSILON ? outstanding : 0;
}

/**
 * Why taking this much out of a transfer to pay a carried debt cannot go
 * ahead, or null when it can. Checked against what the transfer still has
 * left in its own round — money already moved, or set aside as ซื้อหุ้น and
 * the like, is not there to move again.
 */
export function carryAmountProblem(available: number, amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "จำนวนเงินต้องมากกว่า 0";
  }
  if (available <= EPSILON) {
    return "รายการนี้ไม่เหลือยอดให้ย้ายแล้ว";
  }
  if (amount > available + EPSILON) {
    return `ย้ายได้ไม่เกินยอดที่เหลือของรายการนี้ (${available.toFixed(2)} บาท)`;
  }
  return null;
}

export interface DebtSummary {
  amountPaid: number;
  paidAt: Date | null;
  status: "paid" | "overpaid" | "unpaid";
}

/**
 * A carried debt's standing from the payments made toward it — the same
 * paid / overpaid / unpaid rule a round uses, so the two tabs never disagree
 * about what "ชำระครบ" means.
 */
export function summarizeDebt(
  amount: number,
  payments: { amount: number; paidAt: Date }[]
): DebtSummary {
  const amountPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  const paidAt = payments.reduce<Date | null>(
    (latest, p) => (!latest || p.paidAt > latest ? p.paidAt : latest),
    null
  );
  return { amountPaid, paidAt, status: calcPaymentStatus(amountPaid, amount).status };
}
