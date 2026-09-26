import { describe, expect, it } from "vitest";
import {
  bindMissedRoundNote,
  canBridgeToRound,
  coveredByRealTransfer,
  recordBridgedRoundNote,
  recordMissedRoundNote,
} from "../lib/roundReach";
import { DEDUCTION_CATEGORY } from "../lib/statementSlipHints";

const round = { label: "ส.ค. 2569" };

describe("bindMissedRoundNote", () => {
  it("says so when no round moved", () => {
    // Binding can only re-match transfers a round already holds. Where the
    // statement went into the daily page and never into a round, there is
    // nothing there to re-match and the green notice reads as though there
    // were.
    const note = bindMissedRoundNote(0, round);
    expect(note).toContain("ส.ค. 2569");
    expect(note).toContain("เทียบ Statement");
  });

  it("stays quiet when a round did pick it up", () => {
    // The count in the notice already says "จับคู่รอบเก็บไม่ได้ใหม่ 2 รอบ".
    expect(bindMissedRoundNote(2, round)).toBeNull();
    expect(bindMissedRoundNote(1, round)).toBeNull();
  });

  it("stays quiet when there is no round at all", () => {
    // Telling somebody to upload a statement into a round they have not
    // created is not advice.
    expect(bindMissedRoundNote(0, null)).toBeNull();
  });
});

describe("recordMissedRoundNote", () => {
  it("warns when a deduction payment is filed by hand", () => {
    // amountPaid is summed from StatementTransfer and has never read a
    // transaction, so the member goes on owing in the round.
    const note = recordMissedRoundNote(DEDUCTION_CATEGORY, DEDUCTION_CATEGORY, round);
    expect(note).toContain("ส.ค. 2569");
    expect(note).toContain("เทียบ Statement");
  });

  it("says nothing about the categories a round is not keeping score of", () => {
    // Otherwise it would fire on nearly every recording and mean nothing on
    // almost all of them.
    for (const category of ["ฝากเงิน", "ซื้อหุ้น", "ชำระหนี้", "อื่นๆ", ""]) {
      expect(recordMissedRoundNote(category, DEDUCTION_CATEGORY, round)).toBeNull();
    }
  });

  it("stays quiet when there is no round to name", () => {
    expect(recordMissedRoundNote(DEDUCTION_CATEGORY, DEDUCTION_CATEGORY, null)).toBeNull();
  });
});

describe("canBridgeToRound", () => {
  it("lets through a member the round still shows as owing", () => {
    expect(canBridgeToRound({ deductionResult: "uncollected", status: "unpaid" })).toBe(true);
  });

  it("refuses a member the round has already resolved", () => {
    expect(canBridgeToRound({ deductionResult: "uncollected", status: "paid" })).toBe(false);
    expect(canBridgeToRound({ deductionResult: "uncollected", status: "overpaid" })).toBe(false);
  });

  it("lets through a member still on รอผลการหัก, judged later against what was declared", () => {
    // 29375: ฿31,560 recorded against a แจ้งหัก of ฿31,140 while their unit's
    // result had not come back — bridging is what lets recomputeRoundPayments
    // judge them against expectedAmount instead of leaving them stuck on
    // รอผลการหัก with nothing paid.
    expect(canBridgeToRound({ deductionResult: "awaiting", status: "awaiting" })).toBe(true);
  });

  it("refuses a member whose unit already reported the deduction collected", () => {
    // Nothing here for a bank line to settle: collectedStatus ignores
    // amountPaid outright, so bridging one would only be noise.
    expect(canBridgeToRound({ deductionResult: "collected", status: "collected" })).toBe(false);
  });

  it("refuses when the member is not on this round at all", () => {
    expect(canBridgeToRound(null)).toBe(false);
  });
});

describe("recordBridgedRoundNote", () => {
  it("confirms a single recording that landed on the round", () => {
    const note = recordBridgedRoundNote(round, 1, 1);
    expect(note).toContain("ส.ค. 2569");
    expect(note).not.toContain("จาก 1 รายการ");
  });

  it("confirms every row of a bulk recording that all landed", () => {
    const note = recordBridgedRoundNote(round, 5, 5);
    expect(note).toContain("5");
  });

  it("names both counts when only some of a bulk recording landed", () => {
    const note = recordBridgedRoundNote(round, 2, 5);
    expect(note).toContain("2");
    expect(note).toContain("5");
    expect(note).toContain("เทียบ Statement");
  });
});

describe("coveredByRealTransfer", () => {
  const real = [{ accountNumber: "4301008047", amount: 3000, transferredAt: new Date("2026-09-23T11:23:00Z") }];

  it("catches the same bank line already sitting in the round as a real transfer", () => {
    expect(coveredByRealTransfer(real, "4301008047", 3000, new Date("2026-09-23T11:23:00Z"))).toBe(true);
  });

  it("matches on the calendar day, not the exact minute", () => {
    // The daily-view line and the round's own uploaded transfer read the
    // same bank export through different parsers — small timestamp drift
    // must not let a real duplicate through.
    expect(coveredByRealTransfer(real, "4301008047", 3000, new Date("2026-09-23T23:59:00Z"))).toBe(true);
  });

  it("does not match a different day, account, or amount", () => {
    expect(coveredByRealTransfer(real, "4301008047", 3000, new Date("2026-09-24T11:23:00Z"))).toBe(false);
    expect(coveredByRealTransfer(real, "9999999999", 3000, new Date("2026-09-23T11:23:00Z"))).toBe(false);
    expect(coveredByRealTransfer(real, "4301008047", 3001, new Date("2026-09-23T11:23:00Z"))).toBe(false);
  });

  it("is not fooled by a candidate with no date", () => {
    expect(
      coveredByRealTransfer(
        [{ accountNumber: "4301008047", amount: 3000, transferredAt: null }],
        "4301008047",
        3000,
        new Date("2026-09-23T11:23:00Z")
      )
    ).toBe(false);
  });
});
