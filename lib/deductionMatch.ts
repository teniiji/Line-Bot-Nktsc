// What a member still owes on the month's หักไม่ได้ round, put beside the
// money they just transferred in.
//
// The daily view can already say who paid: the account directory and the
// round's own member list between them turn a "TR fr 4130029339" into a name
// and a member number. What it could not say is *what the payment was for*.
// That column is filled from the slip a member sent, and most of these
// transfers arrive with no slip at all — so a screen full of recognised
// members paying recognised amounts read "—" in the one column staff were
// about to have to work out by hand.
//
// Nearly always the answer is sitting in the system: the member is on this
// month's เก็บไม่ได้ list with a figure outstanding, and the transfer is that
// figure. Saying so turns the column from a blank into either a one-click
// confirmation or a discrepancy worth a phone call.
//
// It is deliberately a *hint*, never a decision. The pairing is an amount and
// a name, not a statement from the member, so nothing here records anything —
// it puts the two numbers next to each other and lets the person reading them
// decide.

// A member's row in the most recent หักไม่ได้ round, reduced to what this
// comparison needs.
export interface OutstandingDeduction {
  period: string;
  label: string;
  amountDue: number;
  amountPaid: number;
}

export type DeductionMatch = "exact" | "short" | "over" | "settled" | "counted";

export interface DeductionHint {
  match: DeductionMatch;
  // What was still owed when the round was last updated. Always 0 for
  // "settled" and "counted" — there is nothing left to compare.
  outstanding: number;
  // The round it belongs to, so the column can name the month.
  period: string;
  label: string;
  // Only set for "counted": what the round currently makes of this member,
  // so the label can say why this is not — or not yet — "เก็บไม่ได้ … ชำระแล้ว".
  deductionResult?: string;
}

// Money is equal when it is equal to the satang. Two figures a rounding error
// apart are the same payment; a tolerance any wider would start calling a
// different payment a match.
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * The hint for one statement line, or null when there is nothing to say —
 * money going out, a member nobody recognised, or a member whose round is
 * settled.
 */
export function deductionHint(
  amount: number,
  owed: OutstandingDeduction | null
): DeductionHint | null {
  if (!owed || amount <= 0) return null;
  const outstanding = Math.round((owed.amountDue - owed.amountPaid) * 100) / 100;
  // Nothing outstanding is not a hint: the member has paid, and saying
  // anything here would put a settled row back on somebody's list.
  if (outstanding <= 0) return null;

  const match: DeductionMatch = sameAmount(amount, outstanding)
    ? "exact"
    : amount < outstanding
      ? "short"
      : "over";
  return { match, outstanding, period: owed.period, label: owed.label };
}

/**
 * The hint as the column reads it. Short, because it sits in a table: the
 * amount only appears when it differs from what arrived, since repeating the
 * figure already in the row beside it says nothing.
 */
export function describeDeductionHint(hint: DeductionHint): string {
  const month = hint.label || hint.period;
  if (hint.match === "exact") return `ตรงยอดเก็บไม่ได้ ${month}`;
  if (hint.match === "settled") return `เก็บไม่ได้ ${month} ชำระแล้ว`;
  if (hint.match === "counted") {
    // "เก็บไม่ได้ … ชำระแล้ว" presupposes payroll already failed to deduct
    // this member — true for "settled" above, not for these two: 25823 was
    // still on รอผลการหัก with a real ฿30,000 transfer the round had already
    // matched by account and amount, and the label read "เก็บไม่ได้ … ชำระแล้ว"
    // as though that had been decided.
    if (hint.deductionResult === "awaiting") return `ยอดนี้นับในรอบ ${month} แล้ว — สมาชิกยังรอผลการหัก`;
    if (hint.deductionResult === "collected") return `ยอดนี้นับในรอบ ${month} แล้ว — หน่วยงานหักเงินเดือนได้`;
    return `ยอดนี้นับในรอบ ${month} แล้ว`;
  }
  if (hint.match === "short") return `เก็บไม่ได้ ${month} ยังไม่ครบ`;
  return `เก็บไม่ได้ ${month} เกินยอด`;
}

// A stronger signal than deductionHint above, and a different question. That
// one asks "is anything still owed" and falls silent once the answer is no —
// correct for it, but it leaves a settled line looking exactly like one
// nobody has looked at: the account is known, there is no slip, and nothing
// on screen says why. A member's เทียบ Statement round already knows why,
// because its own matching (lib/statementRecompute.ts) ran independently of
// this daily view and needs no slip to work from — it reads the bank
// statement's account and amount directly.
//
// So this is not inferred from a balance; it is looked up. Given directly —
// "this line's account and amount are an unexcluded transfer the round
// already counted" — because a coincidence (a member's balance happens to
// reach zero the same day from some other, unrelated transfer) must not be
// reported as this line having been the one that paid it.
//
// The round counts a matching transfer for every member on it, whatever
// their deductionResult — matching by account and amount does not wait to
// hear whether payroll succeeded. "เก็บไม่ได้ … ชำระแล้ว" is only true once
// that has actually failed (uncollected); an awaiting or collected member's
// line is said differently, so staff are not told a failed deduction was
// paid off when nothing has failed yet.
export function deductionSettled(
  round: { period: string; label: string },
  deductionResult: string
): DeductionHint {
  if (deductionResult === "uncollected") {
    return { match: "settled", outstanding: 0, period: round.period, label: round.label };
  }
  return { match: "counted", outstanding: 0, period: round.period, label: round.label, deductionResult };
}
