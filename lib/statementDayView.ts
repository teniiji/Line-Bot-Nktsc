// Reading one day's statement as the bank wrote it.
//
// The daily tab splits a day into five findings — matched, slips with no
// money, money nobody claimed, money whose payer is known, and everything
// that is not a member paying in. Each answers a question staff have, and
// none of them answers "show me the statement".
//
// That gap is felt as lines going missing. Four of the five sections are
// collapsed or short, so a day of twenty lines looks like a day of six, and
// the natural conclusion is that the system dropped something. It did not:
// every line is in exactly one section. But a person checking the bank's own
// paper against the screen cannot see that, because the screen is sorted by
// conclusion and the paper is sorted by time.
//
// So the same lines are also offered in the bank's own order, with the bank's
// own columns, and each one labelled with the conclusion the tab reached
// about it. Ticking down the page against the statement then works, and the
// count at the top reconciles to the file.

export type StatementLineStatus =
  // Paired with a slip a member sent.
  | "matched"
  // A member paid in, the directory knows whose account it is, no slip came.
  | "knownPayer"
  // A member paid in and nothing knows who they are. The list to chase.
  | "unknownPayer"
  // Not a member paying in at all — fees, outward transfers, institutional
  // money. Shown because it is on the statement, not because it is owed.
  | "notMemberMoney";

export function statementLineStatus(line: {
  isMemberDeposit: boolean;
  matched: boolean;
  ownerMemberNumber: string | null;
}): StatementLineStatus {
  // Checked first: a line the reconciliation never considers cannot be
  // matched or owned, whatever else is true of it.
  if (!line.isMemberDeposit) return "notMemberMoney";
  if (line.matched) return "matched";
  return line.ownerMemberNumber ? "knownPayer" : "unknownPayer";
}

// Whether the ทำรายการ column can still be filled in on this line.
//
// The column is filled from the slip a line was paired with, so on a day
// nobody has worked through it reads "—" all the way down. That is the job,
// and until now it could only be done from the unclaimed list — which meant a
// payment whose payer the account directory already recognised could be read
// in the statement and recorded nowhere, because knowing who paid is exactly
// what keeps it out of that list.
//
// A line already paired with a slip has its answer and must not be given a
// second one; the bank's own postings were never a member's payment to
// record. What is left is money in with nothing accounted for yet.
export function canRecordFromLine(status: StatementLineStatus): boolean {
  return status === "knownPayer" || status === "unknownPayer";
}

// The label staff read, and the section it corresponds to above — worded so
// the two can be recognised as the same thing.
export const STATUS_LABELS: Record<StatementLineStatus, string> = {
  matched: "ตรงกับสลิป",
  knownPayer: "รู้เจ้าของ ไม่มีสลิป",
  unknownPayer: "ยังไม่รู้ว่าใครโอน",
  notMemberMoney: "ไม่ใช่เงินสมาชิก",
};

// A line whose payer is known and which the month's หักไม่ได้ round has
// already counted for them (lib/deductionMatch.ts: "settled" or "counted").
// Nothing is left to do with it: 28694's ฿7,000 read "รู้เจ้าของ ไม่มีสลิป"
// beside a บันทึก button, though เทียบ Statement had it ✅ ชำระครบ, and
// staff asked whether they still had to record it. They do not — recording
// only adds it to the ธุรกรรม tab, which the findings list above still offers.
//
// Not a member payroll already deducted from ("counted" with deductionResult
// "collected"): they owed the round nothing, so a transfer from their account
// paid something else — ซื้อหุ้น, ฝาก, เงินกู้ — and is exactly the kind of
// line somebody should ask about and record. 22971's ฿70,000 was marked done.
//
// Nor a member whose unit has not sent its ผลการหัก back ("counted" with
// deductionResult "awaiting"): the round has the transfer against them, but
// until the result is in nobody knows whether it pays a failed deduction or
// something else. 30107's ฿490 read ✅ นับในรอบแล้ว before the results were
// even uploaded. It reads "รอผลการหัก" instead, and keeps its บันทึก button.
export function countedInRound(row: {
  status: StatementLineStatus;
  deduction: { match: string; deductionResult?: string } | null;
}): boolean {
  return row.status === "knownPayer" && row.deduction?.match === "settled";
}

// A known payer's line the round matched while the member's result is still
// out — see countedInRound.
export function awaitingResult(row: {
  status: StatementLineStatus;
  deduction: { match: string; deductionResult?: string } | null;
}): boolean {
  return (
    row.status === "knownPayer" &&
    row.deduction?.match === "counted" &&
    row.deduction.deductionResult === "awaiting"
  );
}

export const AWAITING_RESULT_LABEL = "รอผลการหัก";

export const COUNTED_IN_ROUND_LABEL = "นับในรอบแล้ว";

// The status as a person reads it: a counted line says so instead of
// "รู้เจ้าของ ไม่มีสลิป", which read as still waiting on somebody.
export function statusLabelOf(row: {
  status: StatementLineStatus;
  deduction: { match: string; deductionResult?: string } | null;
}): string {
  if (countedInRound(row)) return COUNTED_IN_ROUND_LABEL;
  if (awaitingResult(row)) return AWAITING_RESULT_LABEL;
  return STATUS_LABELS[row.status];
}
