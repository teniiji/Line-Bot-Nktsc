import { describe, expect, it } from "vitest";
import { isSetAsidePiece, parentFingerprintOf, setAsideProblem } from "../lib/transferSetAside";

describe("setAsideProblem", () => {
  it("lets the สสค be cut out of a member's monthly transfer", () => {
    // 29000: ฿9,706 a month, ฿390 of it สสค.
    expect(setAsideProblem(9706, 390, "สสค")).toBeNull();
  });

  it("cuts no more than the row still counts, carried payments included", () => {
    // ฿9,316 of it already paid August's carried debt: ฿390 left to cut.
    expect(setAsideProblem(390, 390, "สสค")).toBeNull();
    expect(setAsideProblem(390, 400, "สสค")).toContain("390.00");
  });

  it("refuses nothing, less than nothing, and an unnamed purpose", () => {
    expect(setAsideProblem(9706, 0, "สสค")).not.toBeNull();
    expect(setAsideProblem(9706, -5, "สสค")).not.toBeNull();
    expect(setAsideProblem(9706, 390, "ชำระเก็บไม่ได้รายเดือน")).not.toBeNull();
    expect(setAsideProblem(9706, 390, "")).not.toBeNull();
  });
});

describe("set-aside pieces", () => {
  it("are named after the row they were cut from", () => {
    const piece = "413|2026-09-05|8592630385|9706::aside:ab12";
    expect(isSetAsidePiece(piece)).toBe(true);
    expect(parentFingerprintOf(piece)).toBe("413|2026-09-05|8592630385|9706");
    expect(isSetAsidePiece("413|2026-09-05|8592630385|9706")).toBe(false);
  });
});
