// Is this report_transaction call about a payment that was logged a moment
// ago, and is already finished?
//
// lib/pendingSlip.ts answers the same question about a payment still open;
// this is the half that was missing. Finalising a transaction deletes its
// pending row, so the very next message starts from nothing: a member who
// answers the confirmation — "ครบแล้วนะคะ 30,000" — has that read as a fresh
// payment, and report_transaction opens a new row for it. The row has no slip,
// so the bot asks for one; the member sends the same slip back; the image
// hash matches the Expense already stored and the bot answers "รายการซ้ำ".
//
// That is the sequence staff reported: "บันทึกแล้ว" → a request for a slip →
// "รายการซ้ำ", ending with a phantom pending row sitting in the way of the
// member's next real payment until it expires.
//
// The escape hatch is the slip. A call carrying one is never suppressed here:
// a member who genuinely pays the same amount twice in ten minutes has a
// second slip, and its hash tells it apart from the first (or matches, and
// the duplicate guard in reportTransaction catches it properly). Only a
// text-only re-report — the one shape that carries no evidence at all — is
// treated as a repeat.

export interface LoggedTransaction {
  amount: number;
  category: string;
  createdAt: Date;
}

export interface ReportedTransaction {
  amount: number | null;
  category: string | null;
  // Whether this particular message carried a slip image or PDF.
  hasSlip: boolean;
}

// Long enough to cover the member reading the confirmation and replying,
// short enough that two genuine payments of the same size on the same day are
// unaffected. The phantom happens in the same breath as the confirmation.
export const REPEAT_WINDOW_MS = 10 * 60 * 1000;

// Bank amounts are stored as floats, so compare with the same tolerance
// reportTransaction uses for its own amount-mismatch check.
const AMOUNT_TOLERANCE = 0.005;

export function isRepeatOfLogged(
  report: ReportedTransaction,
  logged: LoggedTransaction | null,
  now: Date
): boolean {
  // A slip is evidence. Let it through — the hash guards decide.
  if (report.hasSlip) return false;
  if (!logged) return false;

  const age = now.getTime() - logged.createdAt.getTime();
  if (age < 0 || age > REPEAT_WINDOW_MS) return false;

  // No amount means nothing to match on. A member opening a fresh
  // conversation ("อยากบันทึกซื้อหุ้นค่ะ") lands here, and must not be told
  // their payment was already recorded.
  if (report.amount === null) return false;
  if (Math.abs(report.amount - logged.amount) > AMOUNT_TOLERANCE) return false;

  // A stated category that disagrees is a different payment, however close
  // the amounts and the clock.
  if (report.category !== null && report.category !== logged.category) return false;

  return true;
}

// Written to the model, not the member. It has to stop the tool call *and*
// leave the member somewhere useful, because the one case this rule can get
// wrong — two real payments of the same size within ten minutes — is resolved
// by the member sending the second slip, which is what the bot needs anyway.
export const ALREADY_LOGGED_INSTRUCTION =
  "Error: a transaction with this amount was already logged for this member moments ago, and this call carries no slip — this is almost certainly the same payment being reported twice, not a new one. Nothing has been held. Tell the member, in Thai, that this payment is already recorded, and say the amount back so they can check. If they really did make a SECOND payment of the same amount, ask them to send that second slip — do not call report_transaction again without one.";
