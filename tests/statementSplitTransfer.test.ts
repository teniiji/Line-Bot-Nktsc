import { describe, expect, it } from "vitest";
import {
  isFullSplit,
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
