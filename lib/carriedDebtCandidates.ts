// Which bank transfers could be paying a carried debt (ชำระข้ามเดือน).
//
// A closed month's debts are paid by transfers that land in later rounds'
// statements, where nothing ties them to the old month: the round sees a
// member's money and counts it as that round's. Finding them by hand means
// opening every later round and reading down its transfers for 180 names.
// This reads them the other way round — from each debt, every transfer from
// an account the member is known to pay from — and says how much of each the
// round it sits in does not need.
//
// Pure rules only; lib/carriedDebtCandidatesStore.ts reads the rows.

import { countedAmount } from "./carriedDebt";
import { memberNumberKey } from "./memberNumber";
import { periodOfDate } from "./deductionPeriod";

const EPSILON = 0.01;
const round2 = (value: number) => Math.round(value * 100) / 100;

export interface OpenDebt {
  id: string;
  memberNumber: string;
  // What is still owed on it.
  outstanding: number;
  // Every account the member is known to transfer from.
  accounts: string[];
  // First day of the debt's own month. A daily line from before it is an
  // older month's business, not a payment toward this debt.
  since?: Date | null;
}

export interface RoundTransfer {
  id: string;
  roundId: string;
  roundClosed: boolean;
  // Whom the transfer counts for in its own round, or null when nobody.
  memberNumber: string | null;
  accountNumber: string;
  amount: number;
  carriedAmount: number;
  excludedReason: string | null;
  transferredAt: Date | null;
  // Debts staff have said this money is not for ("ไม่ใช่ยอดของหนี้นี้").
  dismissedFor?: string[];
}

// Where the member the transfer counts for stands in that round.
export interface RoundStanding {
  roundId: string;
  memberNumber: string;
  deductionResult: string;
  amountDue: number;
  amountPaid: number;
  // What was asked of payroll that month (ยอดแจ้งหัก).
  expectedAmount?: number | null;
}

// Why the round the transfer sits in can, or cannot, spare it:
//   unplaced  — it counts for nobody there (unknown account, or the member is
//               not on that round's list)
//   collected — payroll deducted the member that month, so the round asked
//               them for nothing and the transfer is left over
//   surplus   — the member overpaid that round by at least this much
//   needed    — the round is still counting it toward its own deduction
//   awaiting  — the round has not heard whether it could deduct yet
export type SpareReason = "unplaced" | "collected" | "surplus" | "needed" | "awaiting";

export interface Candidate {
  debtId: string;
  transferId: string;
  // What the transfer still counts in its own round.
  available: number;
  // How much of that its round does not need.
  spare: number;
  reason: SpareReason;
  // Nothing about it needs a person to decide: the member owes only this
  // one month, the account is nobody else's among the debtors, and the round
  // it sits in can spare it.
  clear: boolean;
  // The amount is exactly what was asked of payroll for the member in the
  // month it arrived — the look of that month's own deduction, paid some
  // other way (a unit transferring for a member who moved away). Never
  // applied in bulk; staff decide.
  looksMonthly: boolean;
}

// A bank line from the daily page (StatementLine) that no round holds. A
// round only ever sees the files uploaded into it, so a debtor's payment can
// sit here for good — and, unlike a round's transfer, nothing counts it for
// anybody, so the whole of what is left of it is spare.
export interface DailyLine {
  id: string;
  // Null for a line whose description names no paying account — a unit's
  // payroll office paying for a member (BSD02 "…/เทศบาล…") is one.
  senderAccount: string | null;
  // Debts staff have said this money is not for ("ไม่ใช่ยอดของหนี้นี้").
  dismissedFor?: string[];
  // Members the เงินเข้าประจำวัน page pairs this line with through a slip
  // they sent or a recording staff made (lib/dailyReconcile.ts). That is how
  // money from an account nobody knows is the member's still finds them.
  owners?: string[];
  // The line's amount less what already went to carried debts.
  available: number;
  // The line's full amount, when it differs from what is still available.
  amount?: number;
  postedAt: Date | null;
}

// Where a member stands on the open round for a given month, to tell whether
// a daily line in that month may be that month's own payment.
export interface MonthStanding {
  period: string;
  memberNumber: string;
  deductionResult: string;
  status: string;
  expectedAmount?: number | null;
}

export interface LineCandidate {
  debtId: string;
  lineId: string;
  available: number;
  // The member still owes the open round for the line's own month, or that
  // round has not heard whether it could deduct yet, so the money may well
  // be for that month instead — staff decide.
  contested: boolean;
  // Found through the daily page's pairing with the member's own slip rather
  // than by account.
  bySlip: boolean;
  // See Candidate.looksMonthly.
  looksMonthly: boolean;
  // The period (MMYY) of the month the line arrived in.
  period: string | null;
  clear: boolean;
}

// Where a planned payment's money comes from: "t:<transferId>" for a round's
// transfer, "l:<lineId>" for a daily line no round holds.
export type PaymentSource = `t:${string}` | `l:${string}`;

export interface PlannedPayment {
  debtId: string;
  source: PaymentSource;
  amount: number;
}

// Whether an amount is exactly that month's ยอดแจ้งหัก for the member.
const matchesExpected = (expected: number | null | undefined, amount: number) =>
  expected !== null && expected !== undefined && expected > EPSILON && Math.abs(expected - amount) < EPSILON;

const standingKey = (roundId: string, memberNumber: string) =>
  `${roundId}|${memberNumberKey(memberNumber) ?? memberNumber}`;

const byDate = (a: RoundTransfer, b: RoundTransfer) =>
  (a.transferredAt?.getTime() ?? 0) - (b.transferredAt?.getTime() ?? 0) || a.id.localeCompare(b.id);

/**
 * How much of each transfer its own round can spare, and why.
 *
 * A member's overpayment is one pool shared by all their transfers in that
 * round, handed out oldest transfer first, so two transfers never both claim
 * the same surplus.
 */
export function spareByTransfer(
  transfers: RoundTransfer[],
  standings: RoundStanding[]
): Map<string, { available: number; spare: number; reason: SpareReason }> {
  const standingOf = new Map(standings.map((s) => [standingKey(s.roundId, s.memberNumber), s]));
  const pool = new Map<string, number>();
  const result = new Map<string, { available: number; spare: number; reason: SpareReason }>();

  for (const transfer of [...transfers].sort(byDate)) {
    const available = countedAmount(transfer);
    const standing = transfer.memberNumber
      ? standingOf.get(standingKey(transfer.roundId, transfer.memberNumber))
      : undefined;

    if (!transfer.memberNumber || !standing) {
      result.set(transfer.id, { available, spare: available, reason: "unplaced" });
      continue;
    }
    if (standing.deductionResult === "collected") {
      result.set(transfer.id, { available, spare: available, reason: "collected" });
      continue;
    }
    if (standing.deductionResult === "awaiting") {
      result.set(transfer.id, { available, spare: 0, reason: "awaiting" });
      continue;
    }
    const key = standingKey(standing.roundId, standing.memberNumber);
    const left = pool.has(key)
      ? (pool.get(key) as number)
      : Math.max(0, round2(standing.amountPaid - standing.amountDue));
    const spare = round2(Math.min(available, left));
    pool.set(key, round2(left - spare));
    result.set(transfer.id, {
      available,
      spare,
      reason: spare > EPSILON ? "surplus" : "needed",
    });
  }
  return result;
}

/**
 * Every transfer that could be paying each open debt.
 *
 * A transfer is the member's when its round already counts it for them, or
 * when it counts for nobody and comes from one of their accounts. One its
 * round counts for somebody else is that person's money, whatever account it
 * came from. A closed round's figures are frozen, so only what it counted for
 * nobody can come out of it.
 */
export function findCandidates(
  debts: OpenDebt[],
  transfers: RoundTransfer[],
  standings: RoundStanding[]
): Candidate[] {
  const open = debts.filter((d) => d.outstanding > EPSILON);
  const spare = spareByTransfer(transfers, standings);

  const openDebtsOf = new Map<string, number>();
  const debtorsOfAccount = new Map<string, Set<string>>();
  for (const debt of open) {
    const key = memberNumberKey(debt.memberNumber) ?? debt.memberNumber;
    openDebtsOf.set(key, (openDebtsOf.get(key) ?? 0) + 1);
    for (const account of debt.accounts) {
      const set = debtorsOfAccount.get(account) ?? new Set<string>();
      set.add(key);
      debtorsOfAccount.set(account, set);
    }
  }

  const standingOf = new Map(standings.map((s) => [standingKey(s.roundId, s.memberNumber), s]));

  const candidates: Candidate[] = [];
  for (const transfer of [...transfers].sort(byDate)) {
    if (transfer.excludedReason) continue;
    if (transfer.roundClosed && transfer.memberNumber) continue;
    const info = spare.get(transfer.id);
    if (!info || info.available <= EPSILON) continue;
    const countedFor = transfer.memberNumber ? memberNumberKey(transfer.memberNumber) : null;

    for (const debt of open) {
      const key = memberNumberKey(debt.memberNumber) ?? debt.memberNumber;
      const mine = countedFor
        ? countedFor === key
        : debt.accounts.includes(transfer.accountNumber);
      if (!mine) continue;
      if (transfer.dismissedFor?.includes(debt.id)) continue;
      const sharedAccount = !countedFor && (debtorsOfAccount.get(transfer.accountNumber)?.size ?? 0) > 1;
      const looksMonthly = matchesExpected(
        standingOf.get(standingKey(transfer.roundId, debt.memberNumber))?.expectedAmount,
        transfer.amount
      );
      candidates.push({
        debtId: debt.id,
        transferId: transfer.id,
        available: info.available,
        spare: info.spare,
        reason: info.reason,
        looksMonthly,
        clear:
          info.spare > EPSILON &&
          (openDebtsOf.get(key) ?? 0) === 1 &&
          !sharedAccount &&
          !looksMonthly,
      });
    }
  }
  return candidates;
}

/**
 * Every daily line no round holds that could be paying each open debt: from
 * one of the member's accounts, and not already used up.
 */
export function findLineCandidates(
  debts: OpenDebt[],
  lines: DailyLine[],
  monthStandings: MonthStanding[]
): LineCandidate[] {
  const open = debts.filter((d) => d.outstanding > EPSILON);
  const openDebtsOf = new Map<string, number>();
  const debtorsOfAccount = new Map<string, Set<string>>();
  for (const debt of open) {
    const key = memberNumberKey(debt.memberNumber) ?? debt.memberNumber;
    openDebtsOf.set(key, (openDebtsOf.get(key) ?? 0) + 1);
    for (const account of debt.accounts) {
      const set = debtorsOfAccount.get(account) ?? new Set<string>();
      set.add(key);
      debtorsOfAccount.set(account, set);
    }
  }
  const expectedIn = new Map(
    monthStandings.map((s) => [
      `${s.period}|${memberNumberKey(s.memberNumber) ?? s.memberNumber}`,
      s.expectedAmount ?? null,
    ])
  );
  const stillOwing = new Set(
    monthStandings
      .filter(
        (s) =>
          (s.deductionResult === "uncollected" && s.status === "unpaid") ||
          s.deductionResult === "awaiting"
      )
      .map((s) => `${s.period}|${memberNumberKey(s.memberNumber) ?? s.memberNumber}`)
  );

  const candidates: LineCandidate[] = [];
  const byLineDate = (a: DailyLine, b: DailyLine) =>
    (a.postedAt?.getTime() ?? 0) - (b.postedAt?.getTime() ?? 0) || a.id.localeCompare(b.id);
  for (const line of [...lines].sort(byLineDate)) {
    if (line.available <= EPSILON) continue;
    const owners = new Set((line.owners ?? []).map((o) => memberNumberKey(o) ?? o));
    for (const debt of open) {
      const key = memberNumberKey(debt.memberNumber) ?? debt.memberNumber;
      const bySlip = owners.has(key);
      const byAccount = line.senderAccount !== null && debt.accounts.includes(line.senderAccount);
      if (!bySlip && !byAccount) continue;
      if (line.dismissedFor?.includes(debt.id)) continue;
      if (debt.since && line.postedAt && line.postedAt < debt.since) continue;
      const period = line.postedAt ? periodOfDate(line.postedAt) : null;
      const looksMonthly =
        period !== null &&
        matchesExpected(expectedIn.get(`${period}|${key}`), line.amount ?? line.available);
      const contested = period ? stillOwing.has(`${period}|${key}`) || looksMonthly : true;
      // An account two debtors share says nothing about which; a slip does.
      const sharedAccount =
        !bySlip && (debtorsOfAccount.get(line.senderAccount as string)?.size ?? 0) > 1;
      candidates.push({
        debtId: debt.id,
        lineId: line.id,
        available: line.available,
        contested,
        bySlip,
        looksMonthly,
        period,
        clear: !contested && (openDebtsOf.get(key) ?? 0) === 1 && !sharedAccount,
      });
    }
  }
  return candidates;
}

/**
 * The payments to make for every candidate nobody needs to decide on: from
 * the oldest money first — round transfers and daily lines alike — as much
 * as can be spared, up to what the debt still owes.
 */
export function planClearPayments(
  debts: OpenDebt[],
  transfers: RoundTransfer[],
  standings: RoundStanding[],
  lines: DailyLine[] = [],
  monthStandings: MonthStanding[] = []
): PlannedPayment[] {
  const owed = new Map(debts.map((d) => [d.id, round2(d.outstanding)]));
  const left = new Map<string, number>();
  const plan: PlannedPayment[] = [];

  const dateOf = new Map<string, number>();
  for (const t of transfers) dateOf.set(`t:${t.id}`, t.transferredAt?.getTime() ?? 0);
  for (const l of lines) dateOf.set(`l:${l.id}`, l.postedAt?.getTime() ?? 0);

  const offers: { debtId: string; source: PaymentSource; spare: number }[] = [
    ...findCandidates(debts, transfers, standings)
      .filter((c) => c.clear)
      .map((c) => ({ debtId: c.debtId, source: `t:${c.transferId}` as PaymentSource, spare: c.spare })),
    ...findLineCandidates(debts, lines, monthStandings)
      .filter((c) => c.clear)
      .map((c) => ({ debtId: c.debtId, source: `l:${c.lineId}` as PaymentSource, spare: c.available })),
  ].sort(
    (a, b) => (dateOf.get(a.source) ?? 0) - (dateOf.get(b.source) ?? 0) || a.source.localeCompare(b.source)
  );

  for (const offer of offers) {
    const spare = left.has(offer.source) ? (left.get(offer.source) as number) : offer.spare;
    const due = owed.get(offer.debtId) ?? 0;
    const amount = round2(Math.min(spare, due));
    if (amount <= EPSILON) continue;
    plan.push({ debtId: offer.debtId, source: offer.source, amount });
    left.set(offer.source, round2(spare - amount));
    owed.set(offer.debtId, round2(due - amount));
  }
  return plan;
}

/**
 * The amount to offer by default when staff apply one candidate by hand:
 * what the round can spare, or — where it can spare nothing and staff have
 * decided otherwise — the whole line, never more than the debt still owes.
 */
export function suggestedAmount(candidate: Candidate, outstanding: number): number {
  const base = candidate.spare > EPSILON ? candidate.spare : candidate.available;
  return round2(Math.max(0, Math.min(base, outstanding)));
}
