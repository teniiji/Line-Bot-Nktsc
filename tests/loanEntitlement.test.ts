import { describe, expect, it } from "vitest";
import {
  LOAN_PRODUCTS,
  assessEntitlement,
  installmentFor,
  levelPayment,
  type EntitlementInput,
} from "../lib/loanCollateral";

const input = (over: Partial<EntitlementInput> = {}): EntitlementInput => ({
  type: "ordinary",
  amount: 1000000,
  termMonths: 150,
  rate: null,
  age: 45,
  memberMonths: 120,
  shares: 400000,
  salary: 40000,
  otherDeductions: 10000,
  collateralMax: null,
  ...over,
});

describe("published repayment tables", () => {
  it("every row's payment is within 100 baht or 1% of the level payment, so no figure was mistyped", () => {
    for (const p of Object.values(LOAN_PRODUCTS)) {
      for (const r of p.rows) {
        for (const [term, pay] of Object.entries(r.pay)) {
          expect(pay, `${p.type} ${r.upTo} ${term}`).toBeGreaterThan(0);
          expect(Math.abs(pay - levelPayment(r.upTo, p.rate, Number(term))), `${p.type} ${r.upTo} ${term}`).toBeLessThan(Math.max(100, pay * 0.01));
        }
      }
    }
  });

  it("rows run in order up to the type's cap", () => {
    for (const p of Object.values(LOAN_PRODUCTS)) {
      const ups = p.rows.map((r) => r.upTo);
      expect([...ups].sort((a, b) => a - b)).toEqual(ups);
      expect(ups[ups.length - 1]).toBe(p.cap);
    }
  });

  it("uses the table's own figure where it has one", () => {
    expect(installmentFor(LOAN_PRODUCTS.ordinary, 1000000, 150, 5.25)).toEqual({ amount: 9100, fromTable: true });
    expect(installmentFor(LOAN_PRODUCTS.ordinary, 1400000, 150, 5.25)).toEqual({ amount: 12700, fromTable: true });
    expect(installmentFor(LOAN_PRODUCTS.ordinary, 2000000, 240, 5.25)).toEqual({ amount: 13400, fromTable: true });
    expect(installmentFor(LOAN_PRODUCTS.transfer, 5550000, 360, 5.25)).toEqual({ amount: 30500, fromTable: true });
    expect(installmentFor(LOAN_PRODUCTS.transfer, 3800000, 360, 5.25)).toEqual({ amount: 20900, fromTable: true });
    expect(installmentFor(LOAN_PRODUCTS.lowRate, 500000, 72, 4.5)).toEqual({ amount: 8000, fromTable: true });
    expect(installmentFor(LOAN_PRODUCTS.restructure, 100000, 360, 5.25)).toEqual({ amount: 600, fromTable: true });
  });

  it("estimates other amounts, terms or rates with the level payment rounded up to the hundred", () => {
    // 1,234,000 over 150 at 5.25%: 11,236.5 → 11,300.
    expect(installmentFor(LOAN_PRODUCTS.ordinary, 1234000, 150, 5.25)).toEqual({ amount: 11300, fromTable: false });
    expect(installmentFor(LOAN_PRODUCTS.ordinary, 1000000, 120, 5.25).fromTable).toBe(false);
    expect(installmentFor(LOAN_PRODUCTS.ordinary, 1000000, 150, 6).fromTable).toBe(false);
  });
});

describe("assessEntitlement", () => {
  it("gives the payment, the table row and the shares and guarantors it asks for", () => {
    const e = assessEntitlement(input());
    expect(e.installment).toBe(9100);
    expect(e.fromTable).toBe(true);
    expect(e.row).toMatchObject({ upTo: 1000000, minMemberMonths: 25, guarantors: 4 });
    expect(e.sharesNeeded).toBe(200000);
    expect(e.totalPaid).toBe(1365000);
    expect(e.totalInterest).toBeGreaterThan(365000);
    expect(e.totalInterest).toBeLessThan(366000);
  });

  it("takes the lowest of cap, age, salary multiple, shares and membership", () => {
    const e = assessEntitlement(input({ age: 56, salary: 40000, shares: 1000000, memberMonths: 200 }));
    expect(Object.fromEntries(e.limits.map((l) => [l.key, l.amount]))).toEqual({
      cap: 3000000,
      age: 2500000,
      salary: 4000000,
      shares: 5000000,
      membership: 3000000,
    });
    expect(e.ruleMax).toBe(2500000);

    expect(assessEntitlement(input({ shares: 150000 })).ruleMax).toBe(750000);
    expect(assessEntitlement(input({ memberMonths: 20 })).ruleMax).toBe(900000);
    expect(assessEntitlement(input({ salary: 15000 })).ruleMax).toBe(1500000);
  });

  it("warns past the ages the page lists", () => {
    const e = assessEntitlement(input({ age: 58 }));
    expect(e.limits.find((l) => l.key === "age")?.amount).toBe(2000000);
    expect(e.warnings.some((w) => w.includes("อายุ 58 ปี"))).toBe(true);
  });

  it("compares with what collateral covers and says which binds", () => {
    const rule = assessEntitlement(input({ collateralMax: 5000000 }));
    expect(rule).toMatchObject({ ruleMax: 2000000, overallMax: 2000000, binding: "rule" });

    const coll = assessEntitlement(input({ collateralMax: 800000 }));
    expect(coll).toMatchObject({ ruleMax: 2000000, overallMax: 800000, binding: "collateral" });
    expect(coll.checks.find((c) => c.label === "หลักประกันมั่นใจได้ครอบคลุม")?.ok).toBe(false);
    expect(coll.checks.find((c) => c.label === "ไม่เกินสิทธิกู้ตามระเบียบ")?.ok).toBe(true);

    expect(assessEntitlement(input({ collateralMax: -300000 })).overallMax).toBe(0);
    expect(assessEntitlement(input()).binding).toBeNull();
  });

  it("checks the salary left: 10% up to 1,500,000 and 15% above", () => {
    // 40,000 − 10,000 − 9,100 = 20,900 (52.3%).
    const ok = assessEntitlement(input());
    expect(ok.remainingSalary).toBe(20900);
    expect(ok.checks.find((c) => c.label.startsWith("เงินเดือนคงเหลือ"))).toMatchObject({ ok: true, label: "เงินเดือนคงเหลือไม่น้อยกว่า 10%" });

    // 2,000,000 → 18,200 a month; 25,000 − 3,000 − 18,200 = 3,800 (15.2%).
    const big = assessEntitlement(input({ amount: 2000000, salary: 25000, otherDeductions: 3000 }));
    expect(big.checks.find((c) => c.label.startsWith("เงินเดือนคงเหลือ"))).toMatchObject({ ok: true, label: "เงินเดือนคงเหลือไม่น้อยกว่า 15%" });
    const short = assessEntitlement(input({ amount: 2000000, salary: 25000, otherDeductions: 3500 }));
    expect(short.checks.find((c) => c.label.startsWith("เงินเดือนคงเหลือ"))?.ok).toBe(false);
  });

  it("holds the term to what the type allows and defaults to its first", () => {
    expect(assessEntitlement(input({ termMonths: null })).term).toBe(150);
    const long = assessEntitlement(input({ type: "living", termMonths: 240 }));
    expect(long.term).toBe(150);
    expect(long.warnings[0]).toContain("ไม่เกิน 150 งวด");
    expect(assessEntitlement(input({ type: "transfer", amount: 2000000, termMonths: null })).installment).toBe(11000);
  });

  it("low-rate and restructure loans use their own rate, shares and membership rules", () => {
    const low = assessEntitlement(input({ type: "lowRate", amount: 250000, termMonths: null, memberMonths: 2 }));
    expect(low).toMatchObject({ rate: 4.5, term: 72, installment: 4000 });
    expect(low.row?.guarantors).toBe(2);
    expect(low.limits.find((l) => l.key === "membership")?.amount).toBe(0);

    const re = assessEntitlement(input({ type: "restructure", amount: 1500000, termMonths: null, shares: 0 }));
    expect(re.installment).toBe(8300);
    expect(re.sharesNeeded).toBeNull();
    expect(re.limits.map((l) => l.key)).toEqual(["cap"]);
  });

  it("an overridden rate is computed, not looked up, and said", () => {
    const e = assessEntitlement(input({ rate: 6 }));
    expect(e.fromTable).toBe(false);
    expect(e.installment).toBe(Math.ceil(levelPayment(1000000, 6, 150) / 100) * 100);
    expect(e.warnings.some((w) => w.includes("6%"))).toBe(true);
  });
});
