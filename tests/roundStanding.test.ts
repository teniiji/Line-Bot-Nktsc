import { describe, expect, it } from "vitest";
import { sameStanding } from "../lib/roundStanding";

describe("sameStanding", () => {
  const stored = { amountPaid: 13500, paidAt: new Date("2026-09-25T03:14:13Z"), paidBranch: "หนองคาย", status: "paid" };

  it("says nothing needs writing when every figure is already what it would be", () => {
    expect(sameStanding(stored, { ...stored, paidAt: new Date("2026-09-25T03:14:13Z") })).toBe(true);
    expect(sameStanding(stored, { ...stored, amountPaid: 13500.001 })).toBe(true);
  });

  it("writes when anything moved", () => {
    expect(sameStanding(stored, { ...stored, amountPaid: 0 })).toBe(false);
    expect(sameStanding(stored, { ...stored, paidAt: null })).toBe(false);
    expect(sameStanding(stored, { ...stored, paidBranch: "หนองคาย + บึงกาฬ" })).toBe(false);
    expect(sameStanding(stored, { ...stored, status: "awaiting" })).toBe(false);
  });

  it("treats a member with no payment as unchanged when still unpaid", () => {
    const none = { amountPaid: 0, paidAt: null, paidBranch: null, status: "awaiting" };
    expect(sameStanding(none, { ...none })).toBe(true);
  });
});
