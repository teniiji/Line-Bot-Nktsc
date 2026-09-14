import { describe, expect, it } from "vitest";
import { isStaffMarked, markProblem, unmarkProblem } from "../lib/memberMoneyMark";

describe("markProblem", () => {
  it("lets a person claim a line the bank's code did not recognise", () => {
    // ฿10,500 through ถุงเงิน under NMPSDP, sitting in รายการอื่น with nothing
    // to click, waiting on a release before it could be filed at all.
    expect(markProblem({ channel: "other", amount: 10500 })).toBeNull();
  });

  it("refuses money leaving the account", () => {
    // Nothing anybody knows makes an outward transfer or a fee into a member
    // paying in, so this is the one answer that is never a judgement call.
    expect(markProblem({ channel: "other", amount: -2080 })).toContain("ออกจากบัญชี");
    expect(markProblem({ channel: "other", amount: -8 })).not.toBeNull();
  });

  it("refuses a zero-amount line", () => {
    expect(markProblem({ channel: "other", amount: 0 })).not.toBeNull();
  });

  it("says nothing to do about a line the bank already counts as a member's", () => {
    // A page that has gone stale, not a decision anybody is making.
    expect(markProblem({ channel: "transfer", amount: 10500 })).toContain("อยู่แล้ว");
    expect(markProblem({ channel: "qr", amount: 10500 })).not.toBeNull();
  });

  it("treats marking an already-marked line as allowed, for the second click", () => {
    // Two people work the same short list. The route answers this one by
    // changing nothing rather than by reporting a mistake.
    expect(markProblem({ channel: "staff", amount: 10500 })).toBeNull();
    expect(isStaffMarked("staff")).toBe(true);
    expect(isStaffMarked("other")).toBe(false);
  });
});

describe("unmarkProblem", () => {
  it("lets a wrong mark be taken back", () => {
    // The only way to find out a mark was wrong is to make it and look.
    expect(unmarkProblem({ channel: "staff" }, 0)).toBeNull();
  });

  it("refuses once a payment has been filed against the line", () => {
    // Undoing here would leave the transaction pointing at money the day no
    // longer counts as a member's, and nothing on screen would say why.
    expect(unmarkProblem({ channel: "staff" }, 1)).toContain("รายการ");
  });

  it("refuses on a line the bank's own code classified", () => {
    // Not a mark anybody made, so not a mark anybody gets to take back here —
    // that would be reclassifying the bank's statement from a hover button.
    expect(unmarkProblem({ channel: "transfer" }, 0)).not.toBeNull();
    expect(unmarkProblem({ channel: "other" }, 0)).not.toBeNull();
  });
});
