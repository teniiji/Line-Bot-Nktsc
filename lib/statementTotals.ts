// Money in and money out, per cooperative account, from the statement lines
// on screen.
//
// The tab already answers "what arrived and did anybody claim it". It does not
// answer the question a person is asked at the end of the day, which is
// simpler and older than any of that: how much came in, how much went out,
// what is the account worth now, and what were people paying for.
//
// The sign is the bank's. A line is money in or money out because the
// statement says so — never because of its transaction code, which would mean
// keeping a list of codes in step with a bank that adds them. A zero-amount
// line is neither, and is counted in neither direction.
//
// The bank's own postings (fees, outward transfers, institutional money) are
// deliberately included. They are not member money and the reconciliation
// ignores them, but a person adding up a day's movement against the printed
// statement needs every line that moved money or the total will not tie out.
// What they are is kept separate in the category breakdown, not dropped.

import type { DailyStatementRow } from "./types";

// A category on a line that carries no member payment behind it. Kept as a
// row of its own rather than folded into a total: the difference between "we
// do not know what this ฿80,000 was for" and "this ฿8 was a bank fee" is the
// difference between a job to do and a line to ignore.
export const UNKNOWN_CATEGORY = "ยังไม่ระบุ";
export const NOT_MEMBER_MONEY = "ไม่ใช่เงินสมาชิก";

export interface MoneyFlow {
  // "" for the total across every account.
  branch: string;
  inCount: number;
  inAmount: number;
  outCount: number;
  // A positive magnitude: what left the account, written the way a person
  // reading a report says it out loud.
  outAmount: number;
  // In minus out, which is what the closing balance moved by.
  net: number;
}

export interface CategoryTotal {
  category: string;
  count: number;
  amount: number;
}

// The day's reconciliation in three figures: how much members paid in, how
// much of it a slip accounts for, and how much is still nobody's.
export interface DayTally {
  depositCount: number;
  depositAmount: number;
  matchedCount: number;
  matchedAmount: number;
  // Member money with no slip behind it — the known payers and the unknown
  // ones together, which is the list staff work through.
  unmatchedCount: number;
  unmatchedAmount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const empty = (branch: string): MoneyFlow => ({
  branch,
  inCount: 0,
  inAmount: 0,
  outCount: 0,
  outAmount: 0,
  net: 0,
});

function add(flow: MoneyFlow, amount: number): void {
  if (amount > 0) {
    flow.inCount += 1;
    flow.inAmount = round2(flow.inAmount + amount);
  } else if (amount < 0) {
    flow.outCount += 1;
    flow.outAmount = round2(flow.outAmount - amount);
  }
  flow.net = round2(flow.inAmount - flow.outAmount);
}

/**
 * One row per account the rows actually contain, in the bank's own order of
 * account numbers. Derived rather than hardcoded to 413/447, so a third
 * account appears rather than falling out of the report unnoticed.
 */
export function flowByAccount(rows: DailyStatementRow[]): MoneyFlow[] {
  const byBranch = new Map<string, MoneyFlow>();
  for (const row of rows) {
    if (!row.branch) continue;
    const flow = byBranch.get(row.branch) ?? empty(row.branch);
    add(flow, row.amount);
    byBranch.set(row.branch, flow);
  }
  return [...byBranch.values()].sort((a, b) => a.branch.localeCompare(b.branch, "th"));
}

/**
 * The same figures for everything at once. Not a sum of the rows above —
 * computed from the lines — so a line whose account was never read still
 * counts in the total rather than disappearing between the two tables.
 */
export function flowTotal(rows: DailyStatementRow[]): MoneyFlow {
  const flow = empty("");
  for (const row of rows) add(flow, row.amount);
  return flow;
}

/**
 * The reconciliation over exactly the rows given, so the strip at the top of
 * the page can say the same thing as the tables under it.
 *
 * It used to be told by the server, over the whole window, while every table
 * below it followed the account filter and the search box. Narrowing to one
 * account left a heading that still counted both — a person reading ฿2.7M
 * over a list adding up to ฿900,000, with nothing on screen saying why.
 *
 * "สลิป" and "ส่วนต่าง" cannot be shown here and are dropped rather than left
 * unfiltered: a slip with no money behind it belongs to no account (that is
 * what makes it unmatched), so there is nothing to narrow it by. What takes
 * their place answers the same question from the statement's side — how much
 * of this money still has no slip.
 */
export function dayTally(rows: DailyStatementRow[]): DayTally {
  const tally: DayTally = {
    depositCount: 0,
    depositAmount: 0,
    matchedCount: 0,
    matchedAmount: 0,
    unmatchedCount: 0,
    unmatchedAmount: 0,
  };
  for (const row of rows) {
    // The bank's own postings are on the statement but are not a member
    // paying in, so they are no part of this. They keep their place in the
    // money-in/money-out figures, which are about the account rather than
    // about members.
    if (row.status === "notMemberMoney") continue;
    tally.depositCount += 1;
    tally.depositAmount = round2(tally.depositAmount + row.amount);
    if (row.status === "matched") {
      tally.matchedCount += 1;
      tally.matchedAmount = round2(tally.matchedAmount + row.amount);
    } else {
      tally.unmatchedCount += 1;
      tally.unmatchedAmount = round2(tally.unmatchedAmount + row.amount);
    }
  }
  return tally;
}

/**
 * What the money that came in was for, largest first.
 *
 * Only money in: a category describes a member's payment, and nothing going
 * out of the cooperative's account is one.
 */
export function inByCategory(rows: DailyStatementRow[]): CategoryTotal[] {
  const byCategory = new Map<string, CategoryTotal>();
  for (const row of rows) {
    if (row.amount <= 0) continue;
    const name =
      row.status === "notMemberMoney"
        ? NOT_MEMBER_MONEY
        : (row.category ?? UNKNOWN_CATEGORY);
    const entry = byCategory.get(name) ?? { category: name, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount = round2(entry.amount + row.amount);
    byCategory.set(name, entry);
  }
  return [...byCategory.values()].sort(
    (a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "th")
  );
}
