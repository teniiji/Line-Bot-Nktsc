// Pairs a day's money-in against the slips members sent through the bot.
//
// Two independent records of the same events: the bank says an amount arrived
// at a time, the bot says a member claims to have sent an amount. Where they
// line up, nothing needs doing. Where they don't, one of two things is worth a
// person's attention:
//
//   * a slip with no money behind it — a slip for a transfer to somewhere
//     else, a slip sent twice, or one that never happened
//   * money with no slip — cash the cooperative holds without knowing whose it
//     is or what it was for
//
// What this cannot do is be certain. A slip carries a date but no time (the
// bot's record_transaction takes YYYY-MM-DD) and the sender's name but not
// their account number, so for most pairs the only thing to match on is the
// amount. On a day when eleven people each send ฿5,000 the pairing between
// them is a guess. So every pair says how it was arrived at, and the tab
// presents this as a list to read rather than a tick to trust.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DepositLine {
  id: string;
  amount: number;
  postedAt: Date | null;
  // The paying account, where the statement named one.
  senderAccount: string | null;
  channel: string;
  branch: string;
  description: string;
}

export interface SlipRecord {
  id: string;
  amount: number;
  date: Date;
  memberNumber: string | null;
  memberFullName: string | null;
  category: string | null;
}

// How the pair was arrived at, which is what decides whether staff need to
// look at it:
//   account — the statement named the paying account and the directory says
//             it belongs to the member who filed the slip. Near certain.
//   amount  — the amounts agree and nothing contradicts it. A guess whenever
//             the day holds more than one payment of that size.
export type MatchBasis = "account" | "amount";

export interface MatchedPair {
  deposit: DepositLine;
  slip: SlipRecord;
  basis: MatchBasis;
  // True when the slip's date and the bank's posting fall on different days —
  // normal (a late-evening transfer posts the next morning) but worth showing.
  dayApart: boolean;
}

export interface DayReconciliation {
  matched: MatchedPair[];
  // Slips with no money behind them, and money nobody has claimed.
  slipsWithoutMoney: SlipRecord[];
  depositsWithoutSlip: DepositLine[];
  totals: {
    depositCount: number;
    depositAmount: number;
    slipCount: number;
    slipAmount: number;
    matchedCount: number;
    matchedAmount: number;
  };
}

// A slip and its statement line are the same payment, so the amounts are
// equal outright — a tolerance would start pulling in the member's other
// payments that day.
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.01;

const dayOf = (date: Date) => Math.floor(date.getTime() / DAY_MS);

interface Candidate {
  deposit: DepositLine;
  slip: SlipRecord;
  basis: MatchBasis;
  dayApart: boolean;
  rank: number;
}

export function reconcileDay(
  deposits: DepositLine[],
  slips: SlipRecord[],
  // accountNumber → memberNumber, from the MemberBankAccount directory.
  accountOwners: Map<string, string>
): DayReconciliation {
  const candidates: Candidate[] = [];

  for (const deposit of deposits) {
    const owner = deposit.senderAccount ? accountOwners.get(deposit.senderAccount) : undefined;

    for (const slip of slips) {
      if (!sameAmount(deposit.amount, slip.amount)) continue;

      const dayApart =
        deposit.postedAt !== null && dayOf(deposit.postedAt) !== dayOf(slip.date);
      const byAccount = Boolean(owner && slip.memberNumber && owner === slip.memberNumber);

      // A deposit whose account is known to belong to somebody else is not
      // this member's payment however well the amount fits — silence beats a
      // confident wrong pairing here, because the whole point of the view is
      // to surface what does not add up.
      if (owner && slip.memberNumber && owner !== slip.memberNumber) continue;

      candidates.push({
        deposit,
        slip,
        basis: byAccount ? "account" : "amount",
        dayApart,
        // Best evidence first: a known account beats a bare amount, and the
        // same day beats the next one.
        rank: (byAccount ? 0 : 2) + (dayApart ? 1 : 0),
      });
    }
  }

  candidates.sort((a, b) => a.rank - b.rank);

  const matched: MatchedPair[] = [];
  const usedDeposits = new Set<string>();
  const usedSlips = new Set<string>();

  for (const candidate of candidates) {
    if (usedDeposits.has(candidate.deposit.id) || usedSlips.has(candidate.slip.id)) continue;
    usedDeposits.add(candidate.deposit.id);
    usedSlips.add(candidate.slip.id);
    matched.push({
      deposit: candidate.deposit,
      slip: candidate.slip,
      basis: candidate.basis,
      dayApart: candidate.dayApart,
    });
  }

  const sum = (values: number[]) =>
    Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

  return {
    matched,
    slipsWithoutMoney: slips.filter((slip) => !usedSlips.has(slip.id)),
    depositsWithoutSlip: deposits.filter((deposit) => !usedDeposits.has(deposit.id)),
    totals: {
      depositCount: deposits.length,
      depositAmount: sum(deposits.map((d) => d.amount)),
      slipCount: slips.length,
      slipAmount: sum(slips.map((s) => s.amount)),
      matchedCount: matched.length,
      matchedAmount: sum(matched.map((m) => m.deposit.amount)),
    },
  };
}
