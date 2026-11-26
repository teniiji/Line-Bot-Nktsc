import { describe, expect, it } from "vitest";
import { applyEnrollments, type EnrollmentEvent } from "../lib/coverageEnrollments";
import type { CoverageInput } from "../lib/coverage";

const fileDate = new Date("2026-10-31T00:00:00Z");
const member = (n: string, over: Partial<CoverageInput> = {}): CoverageInput => ({
  memberNumber: n, memberName: `สมาชิก ${n}`, unitName: "หน่วย", gender: null, age: 60, sharePeriods: 100,
  shares: 100000, debt: 50000, insuredSum: 0, premium: 0, premiumDeducted: null,
  hasSok: false, hasScs: false, hasSst: false, hasSsk: false, relativeCount: 0, relativeFees: 0,
  debtStatus: null, undeducted: null, ...over,
});
const ev = (n: string, product: string, action: string, date: string, over: Partial<EnrollmentEvent> = {}): EnrollmentEvent => ({
  memberNumber: n, memberName: `ใหม่ ${n}`, unitName: null, age: 40, product, action, status: "pending",
  applicationDate: new Date(`${date}T00:00:00Z`), insuredSum: null, annualPremium: null, ...over,
});

describe("the file with the applications made since", () => {
  it("adds an association and a life policy from the application date", () => {
    const [m] = applyEnrollments(
      [member("1")],
      [ev("1", "sok", "enroll", "2026-11-26"), ev("1", "life", "enroll", "2026-11-27", { insuredSum: 1000000, annualPremium: 9600 })],
      fileDate
    );
    expect(m.hasSok).toBe(true);
    expect(m.insuredSum).toBe(1000000);
    expect(m.changes.map((c) => c.product)).toEqual(["sok", "life"]);
  });

  it("ignores rejected applications and those the file already holds", () => {
    const [m] = applyEnrollments(
      [member("1")],
      [ev("1", "sok", "enroll", "2026-11-26", { status: "rejected" }), ev("1", "scs", "enroll", "2026-10-01")],
      fileDate
    );
    expect(m.hasSok).toBe(false);
    expect(m.hasScs).toBe(false);
    expect(m.changes).toHaveLength(0);
  });

  it("applies a cancellation after an application", () => {
    const [m] = applyEnrollments(
      [member("1", { hasSst: true, relativeCount: 1 })],
      [ev("1", "sst", "cancel", "2026-11-20"), ev("1", "relative", "cancel", "2026-11-21"), ev("1", "relative", "cancel", "2026-11-22")],
      fileDate
    );
    expect(m.hasSst).toBe(false);
    expect(m.relativeCount).toBe(0);
  });

  it("brings in a member the file does not hold, marked as such", () => {
    const rows = applyEnrollments([member("1")], [ev("9", "ssk", "enroll", "2026-11-26"), ev("8", "sok", "cancel", "2026-11-26")], fileDate);
    const added = rows.find((r) => r.memberNumber === "9")!;
    expect(added.notInFile).toBe(true);
    expect(added.hasSsk).toBe(true);
    expect(added.debt).toBeNull();
    expect(rows.find((r) => r.memberNumber === "8")).toBeUndefined();
  });
});
