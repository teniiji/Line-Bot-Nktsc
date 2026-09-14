// The day split by which cooperative account the money landed in.
//
// The tab treats a day as one pile, and it is two: 413 หนองคาย and 447
// บึงกาฬ. Staff reconcile them separately — the two branches are different
// people's work and different statements to tie out against — so a single
// "เงินเข้า 36 รายการ" is a figure neither of them can use.
//
// Slips are deliberately not split. A slip belongs to a member, not to an
// account, and a slip with no money behind it has no account by definition:
// that is exactly what makes it unmatched. Splitting it would mean inventing
// an account for a payment that never arrived.

import type { DailyDepositRow, DailyOtherLineRow, DailySlipRow } from "./types";

export interface AccountTotals {
  branch: string;
  // Money in, whether or not a slip was found for it.
  depositCount: number;
  depositAmount: number;
  matchedCount: number;
  matchedAmount: number;
  // The work: money in this account nobody has claimed yet.
  unclaimedCount: number;
  unclaimedAmount: number;
  // Not member money — fees, the cooperative's own transfers. Counted so the
  // row adds up against the bank's page rather than quietly omitting them.
  otherCount: number;
}

export interface DayByAccount {
  matched: { deposit: DailyDepositRow; slip: DailySlipRow }[];
  depositsWithoutSlip: DailyDepositRow[];
  otherLines: DailyOtherLineRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: { amount: number }[]) => round2(rows.reduce((t, r) => t + r.amount, 0));

// Every branch the day actually contains, in the order the bank's own
// statement numbers them, so the report does not depend on a hardcoded list
// that a third account would silently fall out of.
export function branchesIn(day: DayByAccount): string[] {
  const seen = new Set<string>();
  for (const pair of day.matched) seen.add(pair.deposit.branch);
  for (const row of day.depositsWithoutSlip) seen.add(row.branch);
  for (const row of day.otherLines) seen.add(row.branch);
  seen.delete("");
  return [...seen].sort();
}

export function summariseByAccount(day: DayByAccount): AccountTotals[] {
  return branchesIn(day).map((branch) => {
    const matched = day.matched.filter((p) => p.deposit.branch === branch).map((p) => p.deposit);
    const unclaimed = day.depositsWithoutSlip.filter((d) => d.branch === branch);
    const deposits = [...matched, ...unclaimed];
    return {
      branch,
      depositCount: deposits.length,
      depositAmount: sum(deposits),
      matchedCount: matched.length,
      matchedAmount: sum(matched),
      unclaimedCount: unclaimed.length,
      unclaimedAmount: sum(unclaimed),
      otherCount: day.otherLines.filter((l) => l.branch === branch).length,
    };
  });
}

// The cooperative's accounts that the day says nothing about.
//
// A day holding one account renders no per-account table, because splitting
// one pile into one pile tells nobody anything. But "no table" and "the other
// account has no lines here" look identical on screen, and they are not the
// same fact at all: the second one usually means the statement for that
// account has not been uploaded for these days, and every total on the page
// is then half a day's money presented as a day's.
//
// Named from the account list rather than from the day, because the whole
// point is to name something the day does not contain.
export function missingBranches(day: DayByAccount, known: string[]): string[] {
  const present = new Set(branchesIn(day));
  return known.filter((branch) => !present.has(branch)).sort();
}
