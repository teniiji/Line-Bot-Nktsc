import { describe, expect, it } from "vitest";
import { matchSlipHints, DEDUCTION_CATEGORY } from "../lib/statementSlipHints";

const transfer = (over: Partial<Parameters<typeof matchSlipHints>[0][number]> = {}) => ({
  id: "t1",
  memberNumber: "001001",
  amount: 5000,
  transferredAt: new Date("2026-08-26"),
  ...over,
});

const slip = (over: Partial<Parameters<typeof matchSlipHints>[1][number]> = {}) => ({
  memberNumber: "001001",
  amount: 5000,
  date: new Date("2026-08-25"),
  category: "ซื้อหุ้น",
  ...over,
});

describe("matchSlipHints", () => {
  it("flags a transfer that lines up with a slip filed under another purpose", () => {
    const hints = matchSlipHints([transfer()], [slip()]);
    expect(hints.get("t1")).toMatchObject({ category: "ซื้อหุ้น", amount: 5000 });
  });

  it("says nothing when the slip is the deduction payment itself", () => {
    const hints = matchSlipHints([transfer()], [slip({ category: DEDUCTION_CATEGORY })]);
    expect(hints.size).toBe(0);
  });

  it("does not cross members", () => {
    const hints = matchSlipHints([transfer()], [slip({ memberNumber: "009999" })]);
    expect(hints.size).toBe(0);
  });

  it("requires the amount to be the same payment, not merely close", () => {
    expect(matchSlipHints([transfer()], [slip({ amount: 5001 })]).size).toBe(0);
    expect(matchSlipHints([transfer()], [slip({ amount: 5000.005 })]).size).toBe(1);
  });

  it("allows a few days between the slip and the bank posting it", () => {
    expect(
      matchSlipHints([transfer({ transferredAt: new Date("2026-08-28") })], [slip()]).size
    ).toBe(1);
    expect(
      matchSlipHints([transfer({ transferredAt: new Date("2026-09-10") })], [slip()]).size
    ).toBe(0);
  });

  it("still hints on member and amount when the statement date was unreadable", () => {
    const hints = matchSlipHints([transfer({ transferredAt: null })], [slip()]);
    expect(hints.size).toBe(1);
  });

  it("uses each slip once, so one slip cannot flag two identical transfers", () => {
    const hints = matchSlipHints(
      [transfer({ id: "t1" }), transfer({ id: "t2" })],
      [slip()]
    );
    expect(hints.size).toBe(1);
    expect(hints.has("t1")).toBe(true);
  });

  it("ignores transfers that belong to nobody yet", () => {
    const hints = matchSlipHints([transfer({ memberNumber: null })], [slip()]);
    expect(hints.size).toBe(0);
  });
});
