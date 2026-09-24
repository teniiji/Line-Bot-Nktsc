// Moving part — or all — of one transfer's credit to a different member.
//
// A statement line is one payment; it is not always one person's. Somebody
// transfers on a relative's behalf, or sends a single lump sum that happens
// to cover two members' เก็บไม่ได้ at once. Until now the only lever on a
// transfer was excludedReason, and that only ever takes money *out* of the
// round's count — there was no way to say "this belongs to somebody else
// instead", so the second member's debt kept reading as unpaid no matter
// what staff did to the first member's row.
//
// A split is two decisions in one: how much of this transfer actually
// belongs to the other member (up to the whole amount, when the transfer
// was never partly this account holder's to begin with), and who that member
// is. What is left behind, if anything, stays exactly what it was — still
// the original account's own payment, matched the ordinary way.

// Two amounts are the same payment once they are within a satang of each
// other — the same tolerance used everywhere else money is compared in this
// codebase (see lib/deductionMatch.ts).
const EPSILON = 0.01;

/**
 * Why a split cannot proceed, or null when it can. Checked against the
 * transfer's own amount — never against what a person merely typed, since a
 * split that quietly moved more money than the transfer carried would create
 * money the statement never reported.
 */
export function splitAmountProblem(transferAmount: number, amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "จำนวนเงินที่จะย้ายต้องมากกว่า 0";
  }
  if (amount > transferAmount + EPSILON) {
    return `ย้ายได้ไม่เกินยอดของรายการนี้ (${transferAmount.toFixed(2)} บาท)`;
  }
  return null;
}

/**
 * Whether this split takes the transfer's entire amount, within rounding —
 * the case that needs no second row, because nothing is left for the
 * original account to keep.
 */
export function isFullSplit(transferAmount: number, amount: number): boolean {
  return transferAmount - amount <= EPSILON;
}

/**
 * What stays with the original account after amount moves elsewhere, rounded
 * to the satang so a split never leaves a fraction the bank never sent.
 */
export function remainingAfterSplit(transferAmount: number, amount: number): number {
  return Math.round((transferAmount - amount) * 100) / 100;
}
