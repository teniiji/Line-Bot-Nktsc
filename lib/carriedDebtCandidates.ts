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

const EPSILON = 0.01;
const round2 = (value: number) => Math.round(value * 100) / 100;

export interface OpenDebt {
  id: string;
  memberNumber: string;
  // What is still owed on it.
  outstanding: number;
  // Every account the member is known to transfer from.
  accounts: string[];
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
}

// Where the member the transfer counts for stands in that round.
export interface RoundStanding {
  roundId: string;
  memberNumber: string;
  deductionResult: string;
  amountDue: number;
  amountPaid: number;
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
}

export interface PlannedPayment {
  debtId: string;
  transferId: string;
  amount: number;
}

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
      const sharedAccount = !countedFor && (debtorsOfAccount.get(transfer.accountNumber)?.size ?? 0) > 1;
      candidates.push({
        debtId: debt.id,
        transferId: transfer.id,
        available: info.available,
        spare: info.spare,
        reason: info.reason,
        clear: info.spare > EPSILON && (openDebtsOf.get(key) ?? 0) === 1 && !sharedAccount,
      });
    }
  }
  return candidates;
}

/**
 * The payments to make for every candidate nobody needs to decide on: from
 * the oldest transfer first, as much as its round can spare, up to what the
 * debt still owes.
 */
export function planClearPayments(
  debts: OpenDebt[],
  transfers: RoundTransfer[],
  standings: RoundStanding[]
): PlannedPayment[] {
  const owed = new Map(debts.map((d) => [d.id, round2(d.outstanding)]));
  const left = new Map<string, number>();
  const plan: PlannedPayment[] = [];

  for (const candidate of findCandidates(debts, transfers, standings)) {
    if (!candidate.clear) continue;
    const spare = left.has(candidate.transferId)
      ? (left.get(candidate.transferId) as number)
      : candidate.spare;
    const due = owed.get(candidate.debtId) ?? 0;
    const amount = round2(Math.min(spare, due));
    if (amount <= EPSILON) continue;
    plan.push({ debtId: candidate.debtId, transferId: candidate.transferId, amount });
    left.set(candidate.transferId, round2(spare - amount));
    owed.set(candidate.debtId, round2(due - amount));
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
