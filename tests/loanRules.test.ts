import { describe, expect, it } from "vitest";
import { assessEligibility, equalPayment, monthlyPayment, type EligibilityInput } from "../lib/loanRules";

const base = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  product: "ordinary",
  amount: 1000000,
  term: 150,
  age: 45,
  months: 100,
  shares: 300000,
  salary: 40000,
  otherDeductions: 5000,
  currentRepayments: 0,
  refinancedRepayments: 0,
  neverBorrowed: false,
  ...over,
});

describe("monthlyPayment", () => {
  it("takes a listed amount from the cooperative's table", () => {
    expect(monthlyPayment("ordinary", 1000000, 150)).toEqual({ payment: 9100, fromTable: true });
    expect(monthlyPayment("ordinary", 3000000, 240)).toEqual({ payment: 20100, fromTable: true });
    expect(monthlyPayment("transfer", 5550000, 360)).toEqual({ payment: 30500, fromTable: true });
    expect(monthlyPayment("lowInterest", 250000, 72)).toEqual({ payment: 4000, fromTable: true });
    expect(monthlyPayment("restructure", 100000, 360)).toEqual({ payment: 600, fromTable: true });
  });

  it("works out any other amount as an equal-payment loan, rounded up to the hundred", () => {
    expect(Math.round(equalPayment(1000000, 5.25, 150))).toBe(9106);
    expect(monthlyPayment("ordinary", 1050000, 150)).toEqual({ payment: 9600, fromTable: false });
  });
});

describe("assessEligibility", () => {
  it("passes a loan inside every rule and finds the largest allowed", () => {
    const e = assessEligibility(base());
    expect(e.checks.every((c) => c.state === "ok")).toBe(true);
    expect(e.guarantors).toBe(4);
    expect(e.sharesNeeded).toBe(200000);
    expect(e.remaining).toBe(40000 - 5000 - 9100);
    expect(e.requiredPct).toBe(10);
    // 100 × 40,000 = 4,000,000 is above the 3,000,000 cap; 3,000,000 at 150
    // งวด (27,300) leaves 7,700 = 19.25% of salary, and above 1.5M 15% is needed.
    expect(e.capByRules).toBe(3000000);
    expect(e.maxAmount).toBe(3000000);
  });

  it("caps by months of membership, salary multiple and age", () => {
    const young = assessEligibility(base({ months: 20, amount: 1000000 }));
    expect(young.capByRules).toBe(900000);
    expect(young.checks.find((c) => c.label === "อายุการเป็นสมาชิก")?.state).toBe("fail");

    const lowPay = assessEligibility(base({ salary: 15000, amount: 2000000 }));
    expect(lowPay.capByRules).toBe(1500000);
    expect(lowPay.checks.find((c) => c.label.startsWith("ไม่เกิน 100 เท่า"))?.state).toBe("fail");

    const older = assessEligibility(base({ age: 56, salary: 60000, amount: 2800000 }));
    expect(older.capByRules).toBe(2500000);
    expect(older.capReasons).toContain("อายุ 56 ปี กู้ได้ไม่เกิน 2,500,000");

    const tooOld = assessEligibility(base({ age: 58 }));
    expect(tooOld.checks.find((c) => c.label === "อายุตัวสมาชิก")?.state).toBe("unknown");
  });

  it("checks the salary left, counting the repayments the new loan pays off", () => {
    const tight = assessEligibility(base({ amount: 2000000, salary: 40000, otherDeductions: 10000, currentRepayments: 12000 }));
    // 40,000 − 10,000 − 12,000 − 18,200 = −200
    expect(tight.remaining).toBe(-200);
    expect(tight.checks.find((c) => c.label === "เงินเดือนคงเหลือหลังหัก")?.state).toBe("fail");
    const refinanced = assessEligibility(base({ amount: 2000000, salary: 40000, otherDeductions: 10000, currentRepayments: 12000, refinancedRepayments: 12000 }));
    expect(refinanced.remaining).toBe(11800);
    expect(refinanced.remainingPct).toBe(29.5);
    expect(refinanced.checks.find((c) => c.label === "เงินเดือนคงเหลือหลังหัก")?.state).toBe("ok");
  });

  it("asks a first-time borrower for 30% left, and the transfer loan 50% above 3.8 million", () => {
    expect(assessEligibility(base({ neverBorrowed: true })).requiredPct).toBe(30);
    const t = assessEligibility(base({ product: "transfer", term: 360, amount: 4000000, months: 40, salary: 60000, otherDeductions: 0, shares: 900000 }));
    expect(t.requiredPct).toBe(50);
    expect(t.payment).toBe(22000);
    expect(t.guarantors).toBe(6);
    expect(assessEligibility(base({ product: "transfer", term: 360, months: 20 })).maxAmount).toBeNull();
  });
});
