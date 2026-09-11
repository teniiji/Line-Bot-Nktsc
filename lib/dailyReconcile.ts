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
// What this cannot do is be certain, so every pair says how it was arrived
// at, and the tab presents this as a list to read rather than a tick to
// trust. Five kinds of evidence, strongest first:
//
//   staff       — a person recorded this transaction from this exact bank
//                 line in the daily view, so the pairing was never inferred.
//                 Nothing outranks it and nothing overrides it: a linked
//                 transaction pairs with its line and with no other
//   account     — the statement named the paying account and the directory
//                 says it belongs to the member who filed the slip
//   slipAccount — the slip's own account, masked as the bank printed it,
//                 agrees with the account on the statement. Needs no
//                 directory, which matters because the directory only holds
//                 the members staff have bound by hand
//   time        — the amounts agree and the slip's clock is within an hour
//                 of the bank's posting
//   amount      — the amounts agree and nothing else is known. A guess
//                 whenever the day holds more than one payment of that size
//
// A slip that names an account the statement contradicts is refused
// outright, the same way a directory contradiction is: silence beats a
// confident wrong pairing, because the whole point of the view is to surface
// what does not add up.

import { compareSlipAccount, slipTimeMinutes } from "./slipDetails";
import { differentMembers, sameMember } from "./memberNumber";

const DAY_MS = 24 * 60 * 60 * 1000;

// How close two clocks have to be for the time to count as evidence. A
// transfer posts within minutes, but the two records are a member's banking
// app and the bank's own ledger, and slips get filed a little after they were
// sent — an hour keeps the ordinary skew without letting "some time today"
// pass as a match.
const CLOSE_MINUTES = 60;

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
  // Read off the slip: "HH:MM" on its own clock, and the paying account
  // exactly as printed, mask characters and all. Both are best-effort — a
  // slip may show neither, and everything logged before these were read
  // shows neither.
  transferTime: string | null;
  senderAccount: string | null;
  // The bank line a person recorded this transaction from, when it was
  // recorded that way rather than filed as a slip. null for every slip the
  // bot logged, which is nearly all of them.
  statementLineId: string | null;
}

// How the pair was arrived at, which is what decides whether staff need to
// look at it. See the note at the top of this file for what each one means.
export type MatchBasis = "staff" | "account" | "slipAccount" | "time" | "amount";

export interface MatchedPair {
  deposit: DepositLine;
  slip: SlipRecord;
  basis: MatchBasis;
  // True when the slip's date and the bank's posting fall on different days —
  // normal (a late-evening transfer posts the next morning) but worth showing.
  dayApart: boolean;
  // Minutes between the slip's clock and the bank's posting, when both are
  // known. Shown as-is: a pair four hours apart is still probably right, but
  // it is the one a person should look at first.
  minutesApart: number | null;
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

// Which calendar day a timestamp falls on. Both sides carry the same clock —
// the bank's wall clock in UTC for a posting, the cooperative's own for a
// transaction (see lib/cooperativeClock.ts) — so one reading serves for both.
// While a slip's date was still a real instant, every slip filed after
// midnight came out a day behind here, and its pairing was ranked as though
// the member had sent it the day before the money arrived.
const dayOf = (date: Date) => Math.floor(date.getTime() / DAY_MS);

// Minutes between the slip's printed clock and the bank's posting, when both
// are known. The bank's timestamps hold its wall clock in UTC (see
// parseStatementDate) and the slip prints the same wall clock, so the two are
// compared as clock times — reading either as a real instant would put an
// offset between two records of the same moment.
function minutesBetween(slip: SlipRecord, deposit: DepositLine): number | null {
  const slipMinutes = slipTimeMinutes(slip.transferTime);
  if (slipMinutes === null || !deposit.postedAt) return null;

  const postedMinutes = deposit.postedAt.getUTCHours() * 60 + deposit.postedAt.getUTCMinutes();
  const dayShift = (dayOf(deposit.postedAt) - dayOf(slip.date)) * 24 * 60;
  return Math.abs(postedMinutes + dayShift - slipMinutes);
}

// Drops a link to a bank line that no longer exists.
//
// The link is a row id. Re-uploading a statement used to delete its rows and
// write them again under new ids, so every link made before
// lib/statementLineMerge.ts stopped that points at an id nothing answers to.
//
// Such a slip is worse off than one that was never linked at all: the link is
// still truthy, so the rule below refuses every deposit it is offered and the
// slip never falls through to the ordinary evidence. The transaction sits in
// "มีสลิปแต่ไม่เจอเงินเข้า" while the money it was recorded from sits in
// "รู้เจ้าของ ไม่มีสลิป" — one payment on two lists that exist to say nobody
// has dealt with it, and a person rings a member who paid weeks ago.
//
// Deciding this needs the ids that exist, not the ids in the window being
// reconciled: a slip at the edge of the range is linked to a line just
// outside it, and reading that as dead would let it be inferred onto somebody
// else's payment.
export function honourLiveLinks(slips: SlipRecord[], liveLineIds: Set<string>): SlipRecord[] {
  return slips.map((slip) =>
    slip.statementLineId && !liveLineIds.has(slip.statementLineId)
      ? { ...slip, statementLineId: null }
      : slip
  );
}

interface Candidate {
  deposit: DepositLine;
  slip: SlipRecord;
  basis: MatchBasis;
  dayApart: boolean;
  minutesApart: number | null;
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
      // A transaction a person recorded from a bank line belongs to that line
      // and to no other, whatever the amounts say. Checked before everything
      // below because it is not evidence to be weighed against the rest — it
      // is somebody having already answered the question this file exists to
      // guess at.
      if (slip.statementLineId) {
        if (slip.statementLineId !== deposit.id) continue;
        candidates.push({
          deposit,
          slip,
          basis: "staff",
          dayApart:
            deposit.postedAt !== null && dayOf(deposit.postedAt) !== dayOf(slip.date),
          minutesApart: minutesBetween(slip, deposit),
          rank: 0,
        });
        continue;
      }

      if (!sameAmount(deposit.amount, slip.amount)) continue;

      const dayApart =
        deposit.postedAt !== null && dayOf(deposit.postedAt) !== dayOf(slip.date);
      // Compared as members rather than as strings: the two numbers reach
      // here from different sources that write them differently, and "29262"
      // against "029262" is one member, not two. See lib/memberNumber.ts.
      const byAccount = sameMember(owner, slip.memberNumber);

      // A deposit whose account is known to belong to somebody else is not
      // this member's payment however well the amount fits — silence beats a
      // confident wrong pairing here, because the whole point of the view is
      // to surface what does not add up.
      if (differentMembers(owner, slip.memberNumber)) continue;

      // The slip's own account says the same thing without needing the
      // directory, and it can say it the other way too: a slip whose visible
      // digits contradict the statement's account is a different payment, so
      // the pair is refused for the same reason as above.
      const slipAccountSays = compareSlipAccount(slip.senderAccount, deposit.senderAccount);
      if (slipAccountSays === "conflict") continue;

      const minutesApart = minutesBetween(slip, deposit);
      const closeInTime = minutesApart !== null && minutesApart <= CLOSE_MINUTES;

      // "staff" is not reachable here — it is decided above, from the link
      // rather than from evidence — and excluding it is what lets the rank
      // table below stay exhaustive.
      const basis: Exclude<MatchBasis, "staff"> = byAccount
        ? "account"
        : slipAccountSays === "match"
          ? "slipAccount"
          : closeInTime
            ? "time"
            : "amount";

      candidates.push({
        deposit,
        slip,
        basis,
        dayApart,
        minutesApart,
        // Best evidence first, so that when several slips fit one deposit the
        // best-supported pairing claims it and the rest fall to the next
        // deposit — a known account beats the slip's own, which beats a clock,
        // which beats a bare amount; and the same day beats the next one.
        // A staff-recorded link sits above all of these at rank 0, so it
        // claims its line before any inference can take it.
        rank:
          { account: 2, slipAccount: 4, time: 6, amount: 8 }[basis] + (dayApart ? 1 : 0),
      });
    }
  }

  // Within the same kind of evidence the closer clock wins: on a day with
  // eleven ฿5,000 transfers, that is the whole difference between a list
  // staff can read and eleven coin flips.
  candidates.sort(
    (a, b) =>
      a.rank - b.rank || (a.minutesApart ?? Number.MAX_SAFE_INTEGER) - (b.minutesApart ?? Number.MAX_SAFE_INTEGER)
  );

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
      minutesApart: candidate.minutesApart,
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
