import { describe, expect, it } from "vitest";
import {
  NOT_MEMBER_MONEY,
  UNKNOWN_CATEGORY,
  flowByAccount,
  flowTotal,
  inByCategory,
} from "../lib/statementTotals";
import type { DailyStatementRow } from "../lib/types";

const line = (over: Partial<DailyStatementRow> = {}): DailyStatementRow => ({
  id: "l1",
  postedAt: "2026-09-10T08:19:54.000Z",
  txnCode: "NBSDT",
  description: "TR fr 4883387836",
  amount: 10000,
  balance: 36761605.6,
  account: "413",
  branch: "หนองคาย",
  channel: "transfer",
  senderAccount: "4883387836",
  status: "matched",
  memberNumber: "900403",
  memberName: "นางสาวศิราณี วงศาสนธิ์",
  unitName: "สมาชิกสมทบ อ.เซกา",
  category: "ฝากเงิน",
  ...over,
});

// The day off the screenshot, in the bank's own order.
const day: DailyStatementRow[] = [
  line({ id: "a", amount: 10000, category: "ฝากเงิน" }),
  line({ id: "b", amount: 4000, status: "knownPayer", category: null }),
  line({ id: "c", amount: 200000, txnCode: "IORSDT", category: "ฝากเงิน" }),
  line({ id: "d", amount: -2080, txnCode: "BPSWT", status: "notMemberMoney", category: null }),
  line({ id: "e", amount: -8, txnCode: "BPSFE", status: "notMemberMoney", category: null }),
  line({ id: "f", amount: 80000, status: "knownPayer", category: null }),
  line({ id: "g", amount: -69749, txnCode: "OTOS", status: "notMemberMoney", category: null }),
  line({ id: "h", amount: 20000, category: "ชำระหนี้" }),
  line({ id: "i", amount: 5000, category: "ชำระหนี้" }),
  line({ id: "j", amount: 3200, category: "ซื้อหุ้น" }),
];

describe("flowTotal", () => {
  it("adds up the day the way somebody is asked for it at four o'clock", () => {
    const total = flowTotal(day);
    expect(total.inCount).toBe(7);
    expect(total.inAmount).toBe(322200);
    expect(total.outCount).toBe(3);
    expect(total.outAmount).toBe(71837);
    expect(total.net).toBe(250363);
  });

  it("writes money out as a positive number", () => {
    // What left the account, said the way a person reading a report says it.
    expect(flowTotal([line({ amount: -2080 })]).outAmount).toBe(2080);
  });

  it("takes the direction from the bank's sign, not the transaction code", () => {
    // Keeping a list of codes would mean keeping it in step with a bank that
    // adds them. The sign is already the answer.
    const oddCode = line({ txnCode: "SOMETHINGNEW", amount: -500 });
    expect(flowTotal([oddCode]).outAmount).toBe(500);
    expect(flowTotal([oddCode]).inCount).toBe(0);
  });

  it("counts a zero-amount line in neither direction", () => {
    const total = flowTotal([line({ amount: 0 })]);
    expect(total.inCount).toBe(0);
    expect(total.outCount).toBe(0);
  });

  it("keeps float noise out of a column of bank amounts", () => {
    // Summed raw these print ฿0.30000000000000004 next to the bank's figure.
    expect(flowTotal([line({ amount: 0.1 }), line({ amount: 0.2 })]).inAmount).toBe(0.3);
  });

  it("says nothing about an empty day", () => {
    expect(flowTotal([])).toMatchObject({ inCount: 0, outCount: 0, net: 0 });
  });
});

describe("flowByAccount", () => {
  const mixed = [
    line({ id: "a", amount: 10000, branch: "หนองคาย" }),
    line({ id: "b", amount: -2080, branch: "หนองคาย" }),
    line({ id: "c", amount: 5000, branch: "บึงกาฬ" }),
    line({ id: "d", amount: -100, branch: "บึงกาฬ" }),
  ];

  it("splits the day into the accounts it reconciles separately", () => {
    const byBranch = Object.fromEntries(flowByAccount(mixed).map((f) => [f.branch, f]));
    expect(byBranch["หนองคาย"]).toMatchObject({ inAmount: 10000, outAmount: 2080, net: 7920 });
    expect(byBranch["บึงกาฬ"]).toMatchObject({ inAmount: 5000, outAmount: 100, net: 4900 });
  });

  it("finds the accounts in the day rather than assuming 413 and 447", () => {
    // A third account has to appear, not fall out of the report unnoticed.
    expect(flowByAccount([line({ branch: "อุดรธานี" })]).map((f) => f.branch)).toEqual([
      "อุดรธานี",
    ]);
  });

  it("does not invent a blank account", () => {
    expect(flowByAccount([line({ branch: "" })])).toEqual([]);
  });

  it("keeps a line whose account was never read inside the overall total", () => {
    // The property the report rests on: the per-account rows may legitimately
    // sum to less than the total, and the total must still be the truth.
    const rows = [...mixed, line({ id: "e", amount: 700, branch: "" })];
    expect(flowTotal(rows).inAmount).toBe(15700);
    expect(flowByAccount(rows).reduce((t, f) => t + f.inAmount, 0)).toBe(15000);
  });
});

describe("inByCategory", () => {
  it("says what the money that came in was for, biggest first", () => {
    const [first, second] = inByCategory(day);
    expect(first).toEqual({ category: "ฝากเงิน", count: 2, amount: 210000 });
    expect(second).toEqual({ category: UNKNOWN_CATEGORY, count: 2, amount: 84000 });
  });

  it("keeps 'nobody has said yet' apart from 'not a member payment'", () => {
    // ฿84,000 nobody has placed is a job to do. A ฿8 bank fee is a line to
    // ignore. Folding them together loses the only distinction that matters.
    const names = inByCategory(day).map((c) => c.category);
    expect(names).toContain(UNKNOWN_CATEGORY);
    expect(names).not.toContain(NOT_MEMBER_MONEY);
  });

  it("names the bank's own money in when there is some", () => {
    const rows = [line({ amount: 1500, status: "notMemberMoney", category: null })];
    expect(inByCategory(rows)).toEqual([{ category: NOT_MEMBER_MONEY, count: 1, amount: 1500 }]);
  });

  it("leaves money out of it entirely", () => {
    // A category describes a member's payment, and nothing leaving the
    // cooperative's account is one.
    expect(inByCategory([line({ amount: -2080, category: "ฝากเงิน" })])).toEqual([]);
  });

  it("adds back up to the money in", () => {
    const total = inByCategory(day).reduce((t, c) => t + c.amount, 0);
    expect(total).toBe(flowTotal(day).inAmount);
  });
});
