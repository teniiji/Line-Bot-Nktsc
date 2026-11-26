import { describe, expect, it } from "vitest";
import { assessLoan, type MemberHoldings } from "../lib/loanCollateral";
import { DEFAULT_RATES } from "../lib/coverage";

const member = (over: Partial<MemberHoldings> = {}): MemberHoldings => ({
  age: 50,
  sharePeriods: 150,
  shares: 300000,
  debt: 1200000,
  insuredSum: 1000000,
  premiumDeducted: true,
  hasSok: true,
  hasScs: true,
  hasSst: false,
  hasSsk: false,
  undeducted: null,
  pending: [],
  ...over,
});

describe("assessLoan", () => {
  it("adds up shares, cover, own associations and welfare against the debt after the loan", () => {
    const a = assessLoan(member(), { amount: 2500000, refinance: 1000000, termMonths: 120 }, DEFAULT_RATES);
    expect(a.items.map((i) => [i.key, i.amount, i.sure])).toEqual([
      ["shares", 300000, true],
      ["life", 1000000, true],
      ["sok", 600000, true],
      ["scs", 600000, true],
      ["welfare", 375000, true],
    ]);
    expect(a.total).toBe(2875000);
    expect(a.debtAfter).toBe(2700000);
    expect(a.margin).toBe(175000);
    expect(a.sureMargin).toBe(175000);
    expect(a.topUp).toBeNull();
    expect(a.maxLoan).toBe(2675000);
  });

  it("says how much cover to add, rounded up to 100,000, with its premium", () => {
    const a = assessLoan(member(), { amount: 3000000, refinance: 1000000, termMonths: 120 }, DEFAULT_RATES);
    expect(a.sureMargin).toBe(-325000);
    expect(a.topUp).toEqual({ insuredSum: 400000, premium: 3840, possible: true, reason: null });
  });

  it("leaves out of มั่นใจได้ what might not pay, but keeps it in รวม", () => {
    const a = assessLoan(
      member({ undeducted: "สสอค", premiumDeducted: false, pending: ["scs"] }),
      { amount: 0, refinance: 0, termMonths: null },
      DEFAULT_RATES
    );
    const byKey = Object.fromEntries(a.items.map((i) => [i.key, i]));
    expect(byKey.life).toMatchObject({ sure: false, note: "หักเบี้ยประกันไม่ได้" });
    expect(byKey.sok).toMatchObject({ sure: false, note: "หักค่าบำรุงไม่ได้" });
    expect(byKey.scs).toMatchObject({ sure: false, note: "ใบสมัครยังรออนุมัติ" });
    expect(a.total).toBe(2875000);
    expect(a.sureTotal).toBe(675000);
    expect(a.warnings).toContain("มีใบสมัครที่ยังรออนุมัติ — ไม่นับในยอดมั่นใจได้จนกว่าจะอนุมัติ");
  });

  it("does not count a policy that ends before the loan does, and says cover cannot be added", () => {
    const a = assessLoan(member({ age: 72 }), { amount: 3000000, refinance: 0, termMonths: 120 }, DEFAULT_RATES);
    expect(a.items.find((i) => i.key === "life")).toMatchObject({ sure: false });
    expect(a.items.find((i) => i.key === "life")!.note).toContain("เกินอายุคุ้มครอง 80 ปี");
    expect(a.topUp?.possible).toBe(false);
  });

  it("caps welfare and the refinanced amount", () => {
    const a = assessLoan(member({ sharePeriods: 400, debt: 100000 }), { amount: 500000, refinance: 900000, termMonths: 60 }, DEFAULT_RATES);
    expect(a.items.find((i) => i.key === "welfare")).toMatchObject({ amount: 600000 });
    expect(a.debtAfter).toBe(500000);
    expect(a.warnings[0]).toContain("ยอดหักกลบมากกว่าหนี้คงเหลือ");
  });
});
