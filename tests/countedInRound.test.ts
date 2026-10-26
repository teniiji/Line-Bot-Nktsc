import { describe, expect, it } from "vitest";
import { awaitingResult, countedInRound, statusLabelOf } from "../lib/statementDayView";

describe("countedInRound", () => {
  it("is a known payer's line the round already counted (28694)", () => {
    const row = { status: "knownPayer" as const, deduction: { match: "settled" } };
    expect(countedInRound(row)).toBe(true);
    expect(statusLabelOf(row)).toBe("นับในรอบแล้ว");
  });

  it("leaves a line that still owes, or has no round hint, as it was", () => {
    for (const match of ["exact", "short", "over"]) {
      const row = { status: "knownPayer" as const, deduction: { match } };
      expect(countedInRound(row)).toBe(false);
      expect(statusLabelOf(row)).toBe("รู้เจ้าของ ไม่มีสลิป");
    }
    expect(countedInRound({ status: "knownPayer", deduction: null })).toBe(false);
  });

  it("leaves a member payroll already deducted from to be asked about (22971)", () => {
    const row = { status: "knownPayer" as const, deduction: { match: "counted", deductionResult: "collected" } };
    expect(countedInRound(row)).toBe(false);
    expect(statusLabelOf(row)).toBe("รู้เจ้าของ ไม่มีสลิป");
  });

  it("waits for the results before calling a line done (30107)", () => {
    const row = { status: "knownPayer" as const, deduction: { match: "counted", deductionResult: "awaiting" } };
    expect(countedInRound(row)).toBe(false);
    expect(awaitingResult(row)).toBe(true);
    expect(statusLabelOf(row)).toBe("รอผลการหัก");
  });

  it("only relabels a known payer's line", () => {
    const counted = { match: "settled" };
    expect(statusLabelOf({ status: "matched", deduction: counted })).toBe("ตรงกับสลิป");
    expect(statusLabelOf({ status: "unknownPayer", deduction: counted })).toBe("ยังไม่รู้ว่าใครโอน");
  });
});
