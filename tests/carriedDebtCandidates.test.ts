import { describe, expect, it } from "vitest";
import {
  findCandidates,
  planClearPayments,
  spareByTransfer,
  suggestedAmount,
  type OpenDebt,
  type RoundStanding,
  type RoundTransfer,
} from "../lib/carriedDebtCandidates";
import { frozenByClosedRound } from "../lib/carriedDebt";
import { findLineCandidates, type DailyLine } from "../lib/carriedDebtCandidates";

const debt = (over: Partial<OpenDebt> = {}): OpenDebt => ({
  id: "d1",
  memberNumber: "29642",
  outstanding: 4700,
  accounts: ["4130000001"],
  ...over,
});

const transfer = (over: Partial<RoundTransfer> = {}): RoundTransfer => ({
  id: "t1",
  roundId: "sep",
  roundClosed: false,
  memberNumber: null,
  accountNumber: "4130000001",
  amount: 4700,
  carriedAmount: 0,
  excludedReason: null,
  transferredAt: new Date("2026-09-05T10:00:00Z"),
  ...over,
});

const standing = (over: Partial<RoundStanding> = {}): RoundStanding => ({
  roundId: "sep",
  memberNumber: "29642",
  deductionResult: "uncollected",
  amountDue: 1000,
  amountPaid: 4700,
  ...over,
});

describe("findCandidates", () => {
  it("offers money its round counts for nobody, from the debtor's account", () => {
    const [c] = findCandidates([debt()], [transfer()], []);
    expect(c).toMatchObject({ debtId: "d1", transferId: "t1", spare: 4700, reason: "unplaced", clear: true });
  });

  it("ignores a transfer from an account that is not the debtor's", () => {
    expect(findCandidates([debt()], [transfer({ accountNumber: "999" })], [])).toEqual([]);
  });

  it("never offers money its round counts for somebody else", () => {
    expect(findCandidates([debt()], [transfer({ memberNumber: "11111" })], [])).toEqual([]);
  });

  it("offers only the member's overpayment when their round counts it for them", () => {
    const [c] = findCandidates([debt()], [transfer({ memberNumber: "29642" })], [standing()]);
    expect(c).toMatchObject({ spare: 3700, reason: "surplus", clear: true });
  });

  it("marks money the round still needs as needed and not clear", () => {
    const [c] = findCandidates(
      [debt()],
      [transfer({ memberNumber: "29642", amount: 1000 })],
      [standing({ amountDue: 1000, amountPaid: 1000 })]
    );
    expect(c).toMatchObject({ spare: 0, reason: "needed", clear: false });
  });

  it("treats a member payroll collected from as owing the round nothing", () => {
    const [c] = findCandidates(
      [debt()],
      [transfer({ memberNumber: "29642" })],
      [standing({ deductionResult: "collected", amountDue: 0 })]
    );
    expect(c).toMatchObject({ spare: 4700, reason: "collected", clear: true });
  });

  it("does not guess for a round still awaiting its deduction result", () => {
    const [c] = findCandidates(
      [debt()],
      [transfer({ memberNumber: "29642" })],
      [standing({ deductionResult: "awaiting" })]
    );
    expect(c).toMatchObject({ spare: 0, reason: "awaiting", clear: false });
  });

  it("skips excluded transfers and ones fully carried already", () => {
    expect(
      findCandidates(
        [debt()],
        [
          transfer({ id: "a", excludedReason: "ซื้อหุ้น" }),
          transfer({ id: "b", carriedAmount: 4700 }),
        ],
        []
      )
    ).toEqual([]);
  });

  it("takes unplaced money from a closed round but never money it counted", () => {
    const found = findCandidates(
      [debt()],
      [
        transfer({ id: "open", roundId: "aug", roundClosed: true }),
        transfer({ id: "counted", roundId: "aug", roundClosed: true, memberNumber: "29642" }),
      ],
      [standing({ roundId: "aug" })]
    );
    expect(found.map((c) => c.transferId)).toEqual(["open"]);
  });

  it("leaves it to staff when the member owes more than one month", () => {
    const found = findCandidates(
      [debt({ id: "jul" }), debt({ id: "aug" })],
      [transfer()],
      []
    );
    expect(found).toHaveLength(2);
    expect(found.every((c) => !c.clear)).toBe(true);
  });

  it("leaves it to staff when two debtors share the account", () => {
    const found = findCandidates(
      [debt(), debt({ id: "d2", memberNumber: "30000" })],
      [transfer()],
      []
    );
    expect(found).toHaveLength(2);
    expect(found.every((c) => !c.clear)).toBe(true);
  });

  it("matches member numbers regardless of leading zeros", () => {
    const [c] = findCandidates(
      [debt({ memberNumber: "029642", accounts: [] })],
      [transfer({ memberNumber: "29642" })],
      [standing()]
    );
    expect(c?.transferId).toBe("t1");
  });
});

describe("spareByTransfer", () => {
  it("shares one overpayment between a member's transfers, oldest first", () => {
    const spare = spareByTransfer(
      [
        transfer({ id: "late", memberNumber: "29642", amount: 3000, transferredAt: new Date("2026-09-20") }),
        transfer({ id: "early", memberNumber: "29642", amount: 3000, transferredAt: new Date("2026-09-02") }),
      ],
      [standing({ amountDue: 1000, amountPaid: 6000 })]
    );
    expect(spare.get("early")?.spare).toBe(3000);
    expect(spare.get("late")?.spare).toBe(2000);
  });
});

describe("planClearPayments", () => {
  it("pays up to what is owed and no more", () => {
    expect(planClearPayments([debt({ outstanding: 2500 })], [transfer()], [])).toEqual([
      { debtId: "d1", source: "t:t1", amount: 2500 },
    ]);
  });

  it("uses several transfers until the debt is paid", () => {
    const plan = planClearPayments(
      [debt({ outstanding: 3000 })],
      [
        transfer({ id: "a", amount: 2000, transferredAt: new Date("2026-09-01") }),
        transfer({ id: "b", amount: 2000, transferredAt: new Date("2026-09-10") }),
        transfer({ id: "c", amount: 2000, transferredAt: new Date("2026-09-20") }),
      ],
      []
    );
    expect(plan).toEqual([
      { debtId: "d1", source: "t:a", amount: 2000 },
      { debtId: "d1", source: "t:b", amount: 1000 },
    ]);
  });

  it("plans nothing that is not clear", () => {
    expect(
      planClearPayments(
        [debt()],
        [transfer({ memberNumber: "29642", amount: 1000 })],
        [standing({ amountPaid: 1000 })]
      )
    ).toEqual([]);
  });
});

describe("suggestedAmount", () => {
  it("offers the spare part, capped at what is owed", () => {
    const [c] = findCandidates([debt()], [transfer({ memberNumber: "29642" })], [standing()]);
    expect(suggestedAmount(c, 4700)).toBe(3700);
    expect(suggestedAmount(c, 500)).toBe(500);
  });

  it("offers the whole line when the round can spare nothing — staff decide", () => {
    const [c] = findCandidates(
      [debt()],
      [transfer({ memberNumber: "29642", amount: 1000 })],
      [standing({ amountPaid: 1000 })]
    );
    expect(suggestedAmount(c, 4700)).toBe(1000);
  });
});

describe("frozenByClosedRound", () => {
  it("freezes only money a closed round counts for somebody", () => {
    expect(frozenByClosedRound(true, "29642")).toBe(true);
    expect(frozenByClosedRound(true, null)).toBe(false);
    expect(frozenByClosedRound(false, "29642")).toBe(false);
  });
});

describe("daily lines no round holds", () => {
  const line = (over: Partial<DailyLine> = {}): DailyLine => ({
    id: "l1",
    senderAccount: "4130000001",
    available: 4700,
    postedAt: new Date("2026-09-07T10:00:00Z"),
    ...over,
  });
  const aug = new Date(Date.UTC(2026, 7, 1));

  it("offers a line from the debtor's account, clear when nothing else claims it", () => {
    const [c] = findLineCandidates([debt({ since: aug })], [line()], []);
    expect(c).toMatchObject({ debtId: "d1", lineId: "l1", available: 4700, contested: false, clear: true });
  });

  it("leaves it to staff when the member still owes that month's open round", () => {
    const [c] = findLineCandidates(
      [debt()],
      [line()],
      [{ period: "0969", memberNumber: "29642", deductionResult: "uncollected", status: "unpaid" }]
    );
    expect(c).toMatchObject({ contested: true, clear: false });
  });

  it("is not contested by a month the member has already settled", () => {
    const [c] = findLineCandidates(
      [debt()],
      [line()],
      [{ period: "0969", memberNumber: "29642", deductionResult: "uncollected", status: "paid" }]
    );
    expect(c).toMatchObject({ contested: false, clear: true });
  });

  it("ignores lines from before the debt's own month and lines used up", () => {
    expect(
      findLineCandidates(
        [debt({ since: aug })],
        [line({ id: "old", postedAt: new Date("2026-07-20T10:00:00Z") }), line({ id: "used", available: 0 })],
        []
      )
    ).toEqual([]);
  });

  it("finds a line with no paying account through the member's own slip", () => {
    // 29755: the unit (เทศบาลนครขอนแก่น) paid ฿13,500 by BSD02, which names
    // no account; the daily page paired it with the member's slip.
    const [c] = findLineCandidates(
      [debt({ memberNumber: "29755", outstanding: 13500, accounts: ["4130514067"], since: aug })],
      [line({ senderAccount: null, owners: ["29755"], available: 13500 })],
      []
    );
    expect(c).toMatchObject({ bySlip: true, contested: false, clear: true, available: 13500 });
  });

  it("does not offer somebody else's slip-paired line", () => {
    expect(
      findLineCandidates([debt()], [line({ senderAccount: null, owners: ["11111"] })], [])
    ).toEqual([]);
  });

  it("leaves it to staff while that month's round is still awaiting the member's result", () => {
    const [c] = findLineCandidates(
      [debt()],
      [line()],
      [{ period: "0969", memberNumber: "29642", deductionResult: "awaiting", status: "awaiting" }]
    );
    expect(c).toMatchObject({ contested: true, clear: false });
  });

  it("trusts a slip over an account two debtors share", () => {
    const found = findLineCandidates(
      [debt(), debt({ id: "d2", memberNumber: "30000" })],
      [line({ owners: ["30000"] })],
      []
    );
    expect(found.find((c) => c.debtId === "d2")).toMatchObject({ bySlip: true, clear: true });
    expect(found.find((c) => c.debtId === "d1")).toMatchObject({ bySlip: false, clear: false });
  });

  it("plans round transfers and daily lines together, oldest money first", () => {
    const plan = planClearPayments(
      [debt({ outstanding: 5000 })],
      [transfer({ id: "t-late", amount: 3000, transferredAt: new Date("2026-09-21T10:00:00Z") })],
      [],
      [line({ available: 4700 })]
    );
    expect(plan).toEqual([
      { debtId: "d1", source: "l:l1", amount: 4700 },
      { debtId: "d1", source: "t:t-late", amount: 300 },
    ]);
  });
});
