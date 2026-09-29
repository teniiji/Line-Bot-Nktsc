import { describe, expect, it } from "vitest";
import { learnedFromLine, reassignProblem } from "../lib/lineReassign";

const ok = { fromMember: "27439", toMember: "27440", pieces: 0, carried: false, closedRound: null };

describe("reassignProblem", () => {
  it("lets a whole recording move to another member", () => {
    expect(reassignProblem(ok)).toBeNull();
  });

  it("needs a different member to move to", () => {
    expect(reassignProblem({ ...ok, toMember: "" })).toMatch(/ต้องระบุ/);
    expect(reassignProblem({ ...ok, toMember: "27439" })).toMatch(/อยู่แล้ว/);
  });

  it("refuses while part of it pays a carried debt, sits in a closed round, or has been cut up", () => {
    expect(reassignProblem({ ...ok, carried: true })).toMatch(/ชำระข้ามเดือน/);
    expect(reassignProblem({ ...ok, closedRound: "ส.ค. 2569" })).toMatch(/ส\.ค\. 2569/);
    expect(reassignProblem({ ...ok, pieces: 1 })).toMatch(/รวมกลับก่อน/);
  });
});

describe("learnedFromLine", () => {
  it("unlearns a unit member only when this line is what taught it", () => {
    expect(learnedFromLine({ lastAmount: 30960.75, viaOffice: null }, 30960.75)).toBe(true);
    // Paid for before at another amount, or brought in by a linked office.
    expect(learnedFromLine({ lastAmount: 12000, viaOffice: null }, 30960.75)).toBe(false);
    expect(learnedFromLine({ lastAmount: 30960.75, viaOffice: "สพป.บึงกาฬ" }, 30960.75)).toBe(false);
    expect(learnedFromLine({ lastAmount: null, viaOffice: null }, 30960.75)).toBe(false);
  });
});
