import { describe, expect, it } from "vitest";
import { bindMissedRoundNote, recordMissedRoundNote } from "../lib/roundReach";
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
