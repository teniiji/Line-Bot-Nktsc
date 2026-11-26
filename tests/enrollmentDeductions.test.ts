import { describe, expect, it } from "vitest";
import {
  byUnit,
  enrolledButUndeducted,
  outstandingDeductionChanges,
  periodOfMonth,
  premiumsToCollect,
  type EnrollmentRow,
} from "../lib/enrollmentDeductions";

const row = (id: string, over: Partial<EnrollmentRow> = {}): EnrollmentRow => ({
  id, memberNumber: id, memberName: null, unitName: "หน่วย ก", product: "sok", action: "enroll", status: "pending",
  applicationDate: "2026-11-20T00:00:00Z", relativeName: null, deductionPeriod: null, paymentMethod: null,
  proratedPremium: null, premiumPaidAt: null, ...over,
});

describe("changes to the รายการหัก", () => {
  it("lists association and relative changes not yet put in a month's list", () => {
    const { add, remove } = outstandingDeductionChanges([
      row("1"),
      row("2", { action: "cancel", product: "sst" }),
      row("3", { status: "rejected" }),
      row("4", { deductionPeriod: "1269" }),
      row("5", { product: "life" }),
      row("6", { product: "relative" }),
    ]);
    expect(add.map((r) => r.id)).toEqual(["1", "6"]);
    expect(remove.map((r) => r.id)).toEqual(["2"]);
  });

  it("groups by unit, unknown last", () => {
    const groups = byUnit([row("20", { unitName: "ข" }), row("3", { unitName: null }), row("10", { unitName: "ข" }), row("1", { unitName: "ก" })]);
    expect(groups.map(([u, l]) => [u, l.map((r) => r.id)])).toEqual([
      ["ก", ["1"]],
      ["ข", ["10", "20"]],
      ["ไม่ทราบหน่วยงาน", ["3"]],
    ]);
  });

  it("names the deduction month as the rounds do", () => {
    expect(periodOfMonth("2026-12")).toBe("1269");
    expect(periodOfMonth("x")).toBeNull();
  });
});

describe("premiums and results", () => {
  it("lists life premiums still to collect", () => {
    const list = premiumsToCollect([
      row("1", { product: "life", proratedPremium: 4000 }),
      row("2", { product: "life", premiumPaidAt: "2026-11-30T00:00:00Z" }),
      row("3", { product: "life", status: "rejected" }),
    ]);
    expect(list.map((r) => r.id)).toEqual(["1"]);
  });

  it("finds members who applied but were หักไม่ได้", () => {
    const out = enrolledButUndeducted(
      [row("1", { deductionPeriod: "1269" }), row("2", { deductionPeriod: "1269" }), row("3")],
      new Map([["1269", new Set(["1", "3"])]])
    );
    expect(out.map((r) => r.id)).toEqual(["1"]);
  });
});
