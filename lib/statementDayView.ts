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

// The label staff read, and the section it corresponds to above — worded so
// the two can be recognised as the same thing.
export const STATUS_LABELS: Record<StatementLineStatus, string> = {
  matched: "ตรงกับสลิป",
  knownPayer: "รู้เจ้าของ ไม่มีสลิป",
  unknownPayer: "ยังไม่รู้ว่าใครโอน",
  notMemberMoney: "ไม่ใช่เงินสมาชิก",
};
