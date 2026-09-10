import { describe, expect, it } from "vitest";
import { branchesIn, summariseByAccount, type DayByAccount } from "../lib/dailyAccountSummary";
import type { DailyDepositRow, DailyOtherLineRow, DailySlipRow } from "../lib/types";

const deposit = (over: Partial<DailyDepositRow> = {}): DailyDepositRow => ({
  id: "d1",
  amount: 1000,
  postedAt: "2026-09-10T09:02:39.000Z",
  senderAccount: "4131150565",
  channel: "transfer",
  branch: "หนองคาย",
  description: "TR fr 4131150565",
  memberNumber: null,
  ...over,
});

const slip = (over: Partial<DailySlipRow> = {}): DailySlipRow => ({
  id: "s1",
  amount: 1000,
  date: "2026-09-10T00:00:00.000Z",
  memberNumber: "15893",
  memberFullName: "นางสมลักษณ์ บุญประกอบ",
  category: "ชำระหนี้",
  transferTime: null,
  senderAccount: null,
  slipImageUrl: null,
  statementLineId: null,
  ...over,
});

const other = (over: Partial<DailyOtherLineRow> = {}): DailyOtherLineRow => ({
  id: "o1",
  amount: -8,
  postedAt: "2026-09-10T08:04:23.000Z",
  txnCode: "BPSFE",
  description: "BP Fee",
  branch: "หนองคาย",
  ...over,
});

// Modelled on a real day: two cooperative accounts, reconciled by different
// people against two different bank statements.
const day: DayByAccount = {
  matched: [
    { deposit: deposit({ id: "m1", amount: 75000, branch: "หนองคาย" }), slip: slip({ amount: 75000 }) },
    { deposit: deposit({ id: "m2", amount: 1400, branch: "หนองคาย" }), slip: slip({ id: "s2", amount: 1400 }) },
    { deposit: deposit({ id: "m3", amount: 5000, branch: "บึงกาฬ" }), slip: slip({ id: "s3", amount: 5000 }) },
  ],
  depositsWithoutSlip: [
    deposit({ id: "u1", amount: 40000, branch: "หนองคาย" }),
    deposit({ id: "u2", amount: 7200, branch: "บึงกาฬ", channel: "cheque" }),
  ],
  otherLines: [other(), other({ id: "o2", branch: "บึงกาฬ" }), other({ id: "o3", branch: "บึงกาฬ" })],
};

describe("branchesIn", () => {
  it("finds the accounts the day actually contains", () => {
    // Derived, never a hardcoded 413/447 — a third account has to appear
    // rather than fall out of the report unnoticed.
    expect(branchesIn(day)).toEqual(["บึงกาฬ", "หนองคาย"]);
  });

  it("sees an account that only has money nobody claimed", () => {
    // The account with nothing but unclaimed money is the one most worth
    // reporting, so it cannot be the one that goes missing.
    expect(
      branchesIn({ matched: [], depositsWithoutSlip: [deposit({ branch: "บึงกาฬ" })], otherLines: [] })
    ).toEqual(["บึงกาฬ"]);
  });

  it("sees an account known only from lines that are not member money", () => {
    expect(
      branchesIn({ matched: [], depositsWithoutSlip: [], otherLines: [other({ branch: "บึงกาฬ" })] })
    ).toEqual(["บึงกาฬ"]);
  });

  it("says nothing about a day with nothing in it", () => {
    expect(branchesIn({ matched: [], depositsWithoutSlip: [], otherLines: [] })).toEqual([]);
  });

  it("does not invent a blank account", () => {
    // An empty branch is a line whose account was not read, not an account.
    expect(
      branchesIn({ matched: [], depositsWithoutSlip: [deposit({ branch: "" })], otherLines: [] })
    ).toEqual([]);
  });
});

describe("summariseByAccount", () => {
  const byBranch = Object.fromEntries(summariseByAccount(day).map((a) => [a.branch, a]));

  it("counts money in per account, matched or not", () => {
    expect(byBranch["หนองคาย"].depositCount).toBe(3);
    expect(byBranch["หนองคาย"].depositAmount).toBe(116400);
    expect(byBranch["บึงกาฬ"].depositCount).toBe(2);
    expect(byBranch["บึงกาฬ"].depositAmount).toBe(12200);
  });

  it("separates what is done from what is somebody's job today", () => {
    expect(byBranch["หนองคาย"].matchedCount).toBe(2);
    expect(byBranch["หนองคาย"].unclaimedCount).toBe(1);
    expect(byBranch["หนองคาย"].unclaimedAmount).toBe(40000);
    expect(byBranch["บึงกาฬ"].matchedCount).toBe(1);
    expect(byBranch["บึงกาฬ"].unclaimedCount).toBe(1);
    expect(byBranch["บึงกาฬ"].unclaimedAmount).toBe(7200);
  });

  it("counts the bank's own lines too, so the row ties out against its page", () => {
    expect(byBranch["หนองคาย"].otherCount).toBe(1);
    expect(byBranch["บึงกาฬ"].otherCount).toBe(2);
  });

  it("adds up to the whole day, with nothing counted twice or dropped", () => {
    // The property the report rests on: split by account and summed back, the
    // day is the same day.
    const all = summariseByAccount(day);
    expect(all.reduce((t, a) => t + a.depositCount, 0)).toBe(
      day.matched.length + day.depositsWithoutSlip.length
    );
    expect(all.reduce((t, a) => t + a.otherCount, 0)).toBe(day.otherLines.length);
    expect(all.reduce((t, a) => t + a.matchedCount + a.unclaimedCount, 0)).toBe(
      day.matched.length + day.depositsWithoutSlip.length
    );
  });

  it("keeps float noise out of the totals", () => {
    // Bank amounts are floats, and a column of them summed raw prints
    // ฿1,000.0000000001 next to the bank's own figure.
    const [only] = summariseByAccount({
      matched: [],
      depositsWithoutSlip: [
        deposit({ id: "a", amount: 0.1 }),
        deposit({ id: "b", amount: 0.2 }),
      ],
      otherLines: [],
    });
    expect(only.depositAmount).toBe(0.3);
  });

  it("returns nothing for a day with nothing in it", () => {
    expect(summariseByAccount({ matched: [], depositsWithoutSlip: [], otherLines: [] })).toEqual([]);
  });
});
