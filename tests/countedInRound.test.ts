import { describe, expect, it } from "vitest";
import { countedInRound, statusLabelOf } from "../lib/statementDayView";

describe("countedInRound", () => {
  it("is a known payer's line the round already counted (28694)", () => {
    for (const match of ["settled", "counted"]) {
      const row = { status: "knownPayer" as const, deduction: { match } };
      expect(countedInRound(row)).toBe(true);
      expect(statusLabelOf(row)).toBe("นับในรอบแล้ว");
    }
  });

  it("leaves a line that still owes, or has no round hint, as it was", () => {
    for (const match of ["exact", "short", "over"]) {
      const row = { status: "knownPayer" as const, deduction: { match } };
      expect(countedInRound(row)).toBe(false);
      expect(statusLabelOf(row)).toBe("รู้เจ้าของ ไม่มีสลิป");
    }
    expect(countedInRound({ status: "knownPayer", deduction: null })).toBe(false);
  });

  it("only relabels a known payer's line", () => {
    const counted = { match: "settled" };
    expect(statusLabelOf({ status: "matched", deduction: counted })).toBe("ตรงกับสลิป");
    expect(statusLabelOf({ status: "unknownPayer", deduction: counted })).toBe("ยังไม่รู้ว่าใครโอน");
  });
});
