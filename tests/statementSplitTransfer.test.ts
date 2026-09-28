import { describe, expect, it } from "vitest";
import {
  isFullSplit,
  overstatedParents,
  parentOfPiece,
  remainingAfterSplit,
  splitAmountProblem,
} from "../lib/statementSplitTransfer";

describe("splitAmountProblem", () => {
  it("accepts an amount within the transfer", () => {
    expect(splitAmountProblem(5600, 3000)).toBeNull();
  });

  it("accepts the whole transfer", () => {
    expect(splitAmountProblem(5600, 5600)).toBeNull();
  });

  it("refuses a zero or negative amount", () => {
    expect(splitAmountProblem(5600, 0)).toContain("มากกว่า 0");
    expect(splitAmountProblem(5600, -100)).toContain("มากกว่า 0");
  });

  it("refuses more than the transfer carries", () => {
    // The transfer is what the bank reported. Moving more than that would
    // create money the statement never actually sent.
    expect(splitAmountProblem(5600, 5601)).toContain("5600.00");
  });

  it("tolerates a satang of rounding either side", () => {
    expect(splitAmountProblem(5600, 5600.004)).toBeNull();
    expect(splitAmountProblem(5600, 5600.02)).not.toBeNull();
  });
});

describe("isFullSplit", () => {
  it("is false when something is left for the original account", () => {
    expect(isFullSplit(5600, 3000)).toBe(false);
  });

  it("is true when the whole transfer moves", () => {
    expect(isFullSplit(5600, 5600)).toBe(true);
  });

  it("treats a satang of rounding as the whole amount", () => {
    expect(isFullSplit(5600, 5599.996)).toBe(true);
  });
});

describe("remainingAfterSplit", () => {
  it("is what the original account keeps", () => {
    expect(remainingAfterSplit(5600, 3000)).toBe(2600);
  });

  it("keeps the figure to the satang", () => {
    expect(remainingAfterSplit(2600.1, 100.05)).toBe(2500.05);
  });
});

describe("overstatedParents", () => {
  const row = (fingerprint: string, amount: number, manualMemberNumber = true) => ({
    fingerprint,
    amount,
    manualMemberNumber,
  });

  it("brings a row written back at the full line down by what was split off it", () => {
    // 13857: ฿5,600, ฿3,000 of it given to 9904, then the file uploaded again
    // before re-uploads left split rows alone.
    expect(overstatedParents([row("fp", 5600, false), row("fp::split:a", 3000)])).toEqual([
      { fingerprint: "fp", amount: 2600 },
    ]);
  });

  it("counts every piece, shares and cut-out parts alike", () => {
    expect(
      overstatedParents([row("fp", 10000, false), row("fp::split:a", 3000), row("fp::aside:b", 500)])
    ).toEqual([{ fingerprint: "fp", amount: 6500 }]);
  });

  it("leaves a row the split already reduced, and one with no pieces", () => {
    expect(
      overstatedParents([row("fp", 2600), row("fp::split:a", 3000), row("other", 5600, false)])
    ).toEqual([]);
  });

  it("gives a share split again to its own row, not the line it first came from", () => {
    expect(parentOfPiece("fp::split:a::split:b")).toBe("fp::split:a");
    expect(
      overstatedParents([row("fp", 5600), row("fp::split:a", 3000), row("fp::split:a::split:b", 1000)])
    ).toEqual([]);
  });

  it("leaves it for a person when the pieces take all of it", () => {
    expect(overstatedParents([row("fp", 3000, false), row("fp::split:a", 3000)])).toEqual([]);
  });
});
