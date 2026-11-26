import { describe, expect, it } from "vitest";
import {
  enrollmentProblem,
  parseApprovalSheet,
  policyEndFor,
  proratedPremium,
  remainingMonths,
  resultOf,
  summarize,
} from "../lib/enrollment";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("the premium for the rest of the policy year", () => {
  it("finds the end of the policy year an application falls in", () => {
    expect(policyEndFor(d("2026-11-26"), "03-31")?.toISOString().slice(0, 10)).toBe("2027-03-31");
    expect(policyEndFor(d("2026-02-10"), "03-31")?.toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(policyEndFor(d("2026-02-10"), null)).toBeNull();
  });

  it("charges whole months, the month applied in included", () => {
    expect(remainingMonths(d("2026-11-26"), d("2027-03-31"))).toBe(5);
    expect(remainingMonths(d("2026-04-01"), d("2027-03-31"))).toBe(12);
    expect(proratedPremium(9600, d("2026-11-26"), "03-31")).toBe(4000);
    expect(proratedPremium(9600, d("2027-03-05"), "03-31")).toBe(800);
  });
});

describe("recording an application", () => {
  const base = {
    memberNumber: "31744",
    product: "sok",
    action: "enroll",
    applicationDate: "2026-11-26",
    eligibilityChecked: true,
    department: "สวัสดิการ",
    recordedBy: "แอน",
  };
  it("needs the announcement's criteria confirmed and who recorded it", () => {
    expect(enrollmentProblem(base)).toBeNull();
    expect(enrollmentProblem({ ...base, eligibilityChecked: false })).toContain("คุณสมบัติ");
    expect(enrollmentProblem({ ...base, recordedBy: "" })).toContain("ผู้บันทึก");
    expect(enrollmentProblem({ ...base, action: "cancel", eligibilityChecked: false })).toBeNull();
  });
  it("needs the sum, premium and how it is paid for life insurance", () => {
    expect(enrollmentProblem({ ...base, product: "life" })).toContain("ทุนประกัน");
    expect(enrollmentProblem({ ...base, product: "life", insuredSum: 1000000, annualPremium: 9600 })).toContain("วิธีชำระ");
    expect(enrollmentProblem({ ...base, product: "life", insuredSum: 1000000, annualPremium: 9600, paymentMethod: "loan" })).toBeNull();
    expect(enrollmentProblem({ ...base, product: "relative" })).toContain("ญาติ");
  });
});

describe("the result files", () => {
  it("reads member numbers, and a result column when there is one", () => {
    expect(
      parseApprovalSheet([[["ลำดับ", "เลขสมาชิก", "ชื่อ", "ผลการพิจารณา"], [1, "031744", "ก", "อนุมัติ"], [2, 25686, "ข", "ไม่อนุมัติ"], [3, "", "", ""]]])
    ).toEqual([
      { memberNumber: "31744", result: "approved" },
      { memberNumber: "25686", result: "rejected" },
    ]);
    expect(parseApprovalSheet([[["เลขสมาชิก", "ชื่อ"], ["4167", "ค"]]])).toEqual([{ memberNumber: "4167", result: null }]);
    expect(() => parseApprovalSheet([[["ชื่อ"]]])).toThrow("เลขสมาชิก");
    expect(resultOf("ผ่าน")).toBe("approved");
  });
});

describe("the month's summary", () => {
  it("counts by product and adds the premium still to collect", () => {
    const s = summarize([
      { product: "life", action: "enroll", status: "pending", proratedPremium: 4000 },
      { product: "life", action: "enroll", status: "rejected", proratedPremium: 800 },
      { product: "sok", action: "cancel", status: "approved", proratedPremium: null },
    ]);
    expect(s.find((r) => r.product === "life")).toMatchObject({ enrolled: 2, pending: 1, rejected: 1, premium: 4000 });
    expect(s.find((r) => r.product === "sok")).toMatchObject({ cancelled: 1, approved: 1 });
  });
});
