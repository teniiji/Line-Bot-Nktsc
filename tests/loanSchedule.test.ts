import { describe, expect, it } from "vitest";
import { addMonths, buildLoanSchedule, ceilQuarter, monthlyInterest } from "../lib/loanSchedule";

const ok = (input: Parameters<typeof buildLoanSchedule>[0]) => {
  const result = buildLoanSchedule(input);
  if (!result.ok) throw new Error(result.problem);
  return result.schedule;
};

describe("ceilQuarter", () => {
  it("rounds interest up to the next .25 .50 .75 .00", () => {
    expect(ceilQuarter(154.17)).toBe(154.25);
    expect(ceilQuarter(153.8)).toBe(154);
    expect(ceilQuarter(153.26)).toBe(153.5);
    expect(ceilQuarter(0.01)).toBe(0.25);
  });

  it("leaves an exact quarter where it is", () => {
    expect(ceilQuarter(154.25)).toBe(154.25);
    expect(ceilQuarter(154.25000000001)).toBe(154.25);
    expect(ceilQuarter(0)).toBe(0);
  });
});

describe("addMonths", () => {
  it("keeps the day of the month", () => {
    expect(addMonths("2026-12-01", 0)).toBe("2026-12-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-12-15", 14)).toBe("2028-02-15");
  });

  it("falls on the last day of a shorter month", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2027-01-31", 2)).toBe("2027-03-31");
  });
});

describe("buildLoanSchedule — fixed number of months", () => {
  const s = ok({ principal: 185000, annualRatePercent: 1, months: 360, startDay: "2026-12-01" });

  it("charges the annuity payment every month", () => {
    expect(s.payment).toBe(595.03);
    expect(s.rows).toHaveLength(360);
    expect(s.rows[0]).toMatchObject({ opening: 185000, interest: 154.25, principalPaid: 440.78, amount: 595.03, closing: 184559.22 });
    expect(s.rows[1].interest).toBe(154);
  });

  it("settles the remainder in the last month", () => {
    const last = s.rows[359];
    expect(last.day).toBe("2056-11-01");
    expect(last.closing).toBe(0);
    expect(last.amount).toBe(647.23);
    expect(s.totalPrincipal).toBe(185000);
    expect(s.totalInterest).toBe(29263);
    expect(s.totalPaid).toBe(214263);
  });
});

describe("buildLoanSchedule — fixed payment", () => {
  it("stops the month the debt is paid off", () => {
    const s = ok({ principal: 200000, annualRatePercent: 1, payment: 1200, startDay: "2026-12-01" });
    const last = s.rows[s.rows.length - 1];
    expect(last.closing).toBe(0);
    expect(last.amount).toBeLessThanOrEqual(1200);
    expect(s.rows.slice(0, -1).every((r) => r.amount === 1200)).toBe(true);
    expect(s.totalPrincipal).toBe(200000);
  });

  it("refuses a payment that never covers the interest", () => {
    expect(monthlyInterest(185000, 1)).toBe(154.25);
    const r = buildLoanSchedule({ principal: 185000, annualRatePercent: 1, payment: 154.25, startDay: "2026-12-01" });
    expect(r.ok).toBe(false);
  });

  it("refuses a schedule too long to be a loan", () => {
    const r = buildLoanSchedule({ principal: 185000, annualRatePercent: 0, payment: 10, startDay: "2026-12-01" });
    expect(r.ok).toBe(false);
  });
});

describe("buildLoanSchedule — zero interest", () => {
  it("splits the principal evenly", () => {
    const s = ok({ principal: 1000, annualRatePercent: 0, months: 3, startDay: "2026-12-01" });
    expect(s.rows.map((r) => r.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(s.totalInterest).toBe(0);
  });
});
