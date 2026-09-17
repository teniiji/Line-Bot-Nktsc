import { describe, expect, it } from "vitest";
import { sortUnmatched, type SortableTransfer } from "../lib/unmatchedSort";

const row = (
  accountNumber: string,
  amount: number,
  transferredAt: string | null,
  branch: string | null = "หนองคาย"
): SortableTransfer => ({ accountNumber, amount, transferredAt, branch });

const rows = [
  row("4320065069", 3400, "2026-08-31T14:26:00.000Z"),
  row("9807994691", 24600, "2026-08-31T14:00:00.000Z", "บึงกาฬ"),
  row("4130443224", 3000, "2026-08-31T12:34:00.000Z"),
  row("4130443224", 1200, "2026-08-31T09:00:00.000Z"),
];

const accounts = (list: SortableTransfer[]) => list.map((r) => r.accountNumber);
const amounts = (list: SortableTransfer[]) => list.map((r) => r.amount);

describe("sortUnmatched", () => {
  it("keeps newest first by default, as the list arrives", () => {
    expect(amounts(sortUnmatched(rows, "newest"))).toEqual([3400, 24600, 3000, 1200]);
  });

  it("runs time the other way on request", () => {
    expect(amounts(sortUnmatched(rows, "oldest"))).toEqual([1200, 3000, 24600, 3400]);
  });

  it("puts the money worth a phone call at the top", () => {
    // ฿24,600 is a different conversation from ฿1,200, and on 36 rows the
    // big one should not be somewhere in the middle.
    expect(amounts(sortUnmatched(rows, "amountDesc"))).toEqual([24600, 3400, 3000, 1200]);
    expect(amounts(sortUnmatched(rows, "amountAsc"))).toEqual([1200, 3000, 3400, 24600]);
  });

  it("groups an account's transfers together when sorted by account", () => {
    // Two accounts differing in the last digit are two members; side by side
    // is the only way to notice.
    expect(accounts(sortUnmatched(rows, "account"))).toEqual([
      "4130443224",
      "4130443224",
      "4320065069",
      "9807994691",
    ]);
  });

  it("puts the accounts that paid in more than once first, and keeps them together", () => {
    // One lookup clears both of those rows, so they are worth doing first.
    const sorted = sortUnmatched(rows, "repeats");
    expect(accounts(sorted).slice(0, 2)).toEqual(["4130443224", "4130443224"]);
    expect(amounts(sorted).slice(0, 2)).toEqual([3000, 1200]);
  });

  it("gathers the two receiving accounts", () => {
    expect(sortUnmatched(rows, "branch").map((r) => r.branch)).toEqual([
      "บึงกาฬ",
      "หนองคาย",
      "หนองคาย",
      "หนองคาย",
    ]);
  });

  it("sorts a row with no date last, whichever way time is running", () => {
    // "Unknown" is not "the oldest": at the top of เก่าสุดก่อน it would be a
    // screenful of rows with nothing in them to chase.
    const withUndated = [...rows, row("1111111111", 500, null)];
    expect(accounts(sortUnmatched(withUndated, "newest")).at(-1)).toBe("1111111111");
    expect(accounts(sortUnmatched(withUndated, "oldest")).at(-1)).toBe("1111111111");
  });

  it("leaves the caller's array alone", () => {
    const original = [...rows];
    sortUnmatched(rows, "amountDesc");
    expect(rows).toEqual(original);
  });

  it("has an answer for an empty list and a single row", () => {
    expect(sortUnmatched([], "repeats")).toEqual([]);
    expect(sortUnmatched([rows[0]], "repeats")).toEqual([rows[0]]);
  });
});
