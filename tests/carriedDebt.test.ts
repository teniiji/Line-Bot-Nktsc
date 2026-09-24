import { describe, expect, it } from "vitest";
import {
  carryAmountProblem,
  countedAmount,
  outstandingAtClose,
  summarizeDebt,
} from "../lib/carriedDebt";

const member = (over: Partial<Parameters<typeof outstandingAtClose>[0]> = {}) => ({
  deductionResult: "uncollected",
  status: "unpaid",
  amountDue: 2000,
  amountPaid: 0,
  ...over,
});

describe("outstandingAtClose", () => {
  it("carries what an uncollected member is still short", () => {
    expect(outstandingAtClose(member())).toBe(2000);
    expect(outstandingAtClose(member({ amountPaid: 1500 }))).toBe(500);
  });

  it("carries nothing for a member who settled or overpaid", () => {
    expect(outstandingAtClose(member({ status: "paid", amountPaid: 2000 }))).toBe(0);
    expect(outstandingAtClose(member({ status: "overpaid", amountPaid: 2500 }))).toBe(0);
  });

  it("carries nothing for a member the round was never chasing", () => {
    // No result from the unit yet — nobody has said they owe anything.
    expect(outstandingAtClose(member({ deductionResult: "awaiting", status: "awaiting" }))).toBe(0);
    // Payroll deducted in full.
    expect(outstandingAtClose(member({ deductionResult: "collected", status: "collected" }))).toBe(0);
  });

  it("rounds to the satang rather than carrying a floating-point crumb", () => {
    expect(outstandingAtClose(member({ amountDue: 100.3, amountPaid: 100.29 }))).toBe(0);
    expect(outstandingAtClose(member({ amountDue: 0.3, amountPaid: 0.1 }))).toBe(0.2);
  });
});

describe("countedAmount", () => {
  it("is the bank's amount less what was moved to a carried debt", () => {
    expect(countedAmount({ amount: 5000, carriedAmount: 0 })).toBe(5000);
    expect(countedAmount({ amount: 5000, carriedAmount: 2000 })).toBe(3000);
    expect(countedAmount({ amount: 5000, carriedAmount: 5000 })).toBe(0);
  });
});

describe("carryAmountProblem", () => {
  it("allows up to what the transfer still has", () => {
    expect(carryAmountProblem(3000, 3000)).toBeNull();
    expect(carryAmountProblem(3000, 1000)).toBeNull();
  });

  it("refuses more than the transfer still has", () => {
    expect(carryAmountProblem(3000, 3000.5)).toContain("3000.00");
  });

  it("refuses nothing, a negative, or a transfer already used up", () => {
    expect(carryAmountProblem(3000, 0)).not.toBeNull();
    expect(carryAmountProblem(3000, -5)).not.toBeNull();
    expect(carryAmountProblem(3000, Number.NaN)).not.toBeNull();
    expect(carryAmountProblem(0, 100)).toContain("ไม่เหลือ");
  });
});

describe("summarizeDebt", () => {
  const aug = new Date("2026-08-20T00:00:00Z");
  const sep = new Date("2026-09-22T00:00:00Z");

  it("is unpaid with nothing paid", () => {
    expect(summarizeDebt(2000, [])).toEqual({ amountPaid: 0, paidAt: null, status: "unpaid" });
  });

  it("sums payments and keeps the latest date", () => {
    expect(
      summarizeDebt(2000, [
        { amount: 1500, paidAt: sep },
        { amount: 500, paidAt: aug },
      ])
    ).toEqual({ amountPaid: 2000, paidAt: sep, status: "paid" });
  });

  it("reads short and over the same way a round does", () => {
    expect(summarizeDebt(2000, [{ amount: 500, paidAt: aug }]).status).toBe("unpaid");
    expect(summarizeDebt(2000, [{ amount: 2500, paidAt: aug }]).status).toBe("overpaid");
  });
});
