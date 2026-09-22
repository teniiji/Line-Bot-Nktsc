import { describe, expect, it } from "vitest";
import {
  deductionHint,
  deductionSettled,
  describeDeductionHint,
  type OutstandingDeduction,
} from "../lib/deductionMatch";

const owed = (over: Partial<OutstandingDeduction> = {}): OutstandingDeduction => ({
  period: "0669",
  label: "มิ.ย. 2569",
  amountDue: 3000,
  amountPaid: 0,
  ...over,
});

describe("deductionHint", () => {
  it("recognises the transfer that settles the month exactly", () => {
    // A screen of members transferring the figure they owe, in a column that
    // read "—" because no slip came with any of it.
    expect(deductionHint(3000, owed())).toMatchObject({ match: "exact", outstanding: 3000 });
  });

  it("says when the transfer does not cover what is owed", () => {
    expect(deductionHint(1000, owed())).toMatchObject({ match: "short", outstanding: 3000 });
  });

  it("says when more arrived than was owed", () => {
    // Worth a look rather than a quiet match: it usually means the transfer
    // is for something else as well.
    expect(deductionHint(5000, owed())).toMatchObject({ match: "over", outstanding: 3000 });
  });

  it("counts what has already been paid against the month", () => {
    // ฿3,000 due, ฿1,800 already in — ฿1,200 left, and that is the figure a
    // transfer has to match.
    expect(deductionHint(1200, owed({ amountPaid: 1800 }))).toMatchObject({
      match: "exact",
      outstanding: 1200,
    });
  });

  it("says nothing about a member whose month is settled", () => {
    // Saying anything here would put a finished row back on somebody's list.
    expect(deductionHint(3000, owed({ amountPaid: 3000 }))).toBeNull();
    expect(deductionHint(3000, owed({ amountPaid: 4000 }))).toBeNull();
  });

  it("says nothing about a member who is not on the round", () => {
    expect(deductionHint(3000, null)).toBeNull();
  });

  it("says nothing about money leaving the account", () => {
    // Whatever the round says, an outward transfer is not a member paying in.
    expect(deductionHint(-3000, owed())).toBeNull();
    expect(deductionHint(0, owed())).toBeNull();
  });

  it("treats a rounding difference as the same figure", () => {
    // Two amounts a satang apart are one payment; anything wider would start
    // calling a different payment a match.
    expect(deductionHint(3000.004, owed())?.match).toBe("exact");
    expect(deductionHint(3001, owed())?.match).toBe("over");
  });

  it("keeps float noise out of the figure it reports", () => {
    expect(deductionHint(100, owed({ amountDue: 3000.1, amountPaid: 0.2 }))?.outstanding).toBe(
      2999.9
    );
  });
});

describe("deductionSettled", () => {
  // A different question from deductionHint above: not "is anything still
  // owed" but "did the round's own matching already count this line" — asked
  // by the route from the round's own transfers directly, never inferred
  // from a balance. A member's outstanding figure can reach zero from a
  // transfer that is not this one, and reporting that as "this line settled
  // it" would be wrong even though the member really is settled.
  it("carries the round's own month, not a balance", () => {
    expect(deductionSettled({ period: "0669", label: "มิ.ย. 2569" })).toEqual({
      match: "settled",
      outstanding: 0,
      period: "0669",
      label: "มิ.ย. 2569",
    });
  });
});

describe("describeDeductionHint", () => {
  it("says a settled line was already paid, not what is outstanding", () => {
    const text = describeDeductionHint(deductionSettled({ period: "0669", label: "มิ.ย. 2569" }));
    expect(text).toContain("มิ.ย. 2569");
    expect(text).toContain("ชำระแล้ว");
  });


  it("names the month, since a round is a month", () => {
    expect(describeDeductionHint(deductionHint(3000, owed())!)).toContain("มิ.ย. 2569");
  });

  it("reads differently for a match and for a shortfall", () => {
    expect(describeDeductionHint(deductionHint(3000, owed())!)).toContain("ตรงยอด");
    expect(describeDeductionHint(deductionHint(1000, owed())!)).toContain("ยังไม่ครบ");
    expect(describeDeductionHint(deductionHint(9000, owed())!)).toContain("เกินยอด");
  });

  it("falls back to the period when a round has no label", () => {
    const hint = deductionHint(3000, owed({ label: "" }))!;
    expect(describeDeductionHint(hint)).toContain("0669");
  });
});
