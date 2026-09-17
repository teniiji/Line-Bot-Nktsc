import { describe, expect, it } from "vitest";
import { splitByBinding, type BoundOwner } from "../lib/boundTransfers";

const row = (accountNumber: string, id = accountNumber) => ({ id, accountNumber, amount: 6690 });

const owner = (over: Partial<BoundOwner> = {}): BoundOwner => ({
  memberNumber: "29819",
  memberName: "นางสาวสยุบภู บุญโสม",
  inRoster: true,
  ...over,
});

describe("splitByBinding", () => {
  it("takes a bound account off the list of work", () => {
    // The report this was written for: staff press บันทึก, the binding saves,
    // and the row sits in "ไม่พบเจ้าของ" looking exactly as it did before.
    const split = splitByBinding(
      [row("6790899405")],
      new Map([["6790899405", owner()]])
    );
    expect(split.unknown).toHaveLength(0);
    expect(split.outsideRound).toHaveLength(1);
    expect(split.outsideRound[0].boundTo.memberNumber).toBe("29819");
  });

  it("leaves an account nobody has placed where it was", () => {
    const split = splitByBinding([row("4130140299")], new Map());
    expect(split.unknown).toHaveLength(1);
    expect(split.unknown[0].boundTo).toBeNull();
    expect(split.outsideRound).toHaveLength(0);
  });

  it("keeps a binding to a number in no list at all on the list of work", () => {
    // The shape of a typo. Moving it out would file the money under a member
    // who may not exist, and take the row off the only list anybody reads.
    const split = splitByBinding(
      [row("6790899405")],
      new Map([["6790899405", owner({ memberNumber: "88888", inRoster: false })]])
    );
    expect(split.outsideRound).toHaveLength(0);
    expect(split.unknown).toHaveLength(1);
    expect(split.unknown[0].boundTo?.memberNumber).toBe("88888");
  });

  it("keeps the rest of each row, so nothing is lost in the split", () => {
    const split = splitByBinding(
      [{ id: "t1", accountNumber: "6790899405", amount: 6690, branch: "หนองคาย" }],
      new Map([["6790899405", owner()]])
    );
    expect(split.outsideRound[0]).toMatchObject({
      id: "t1",
      amount: 6690,
      branch: "หนองคาย",
    });
  });

  it("sends several transfers from one account the same way", () => {
    // A member who paid in three times is three rows, and finishing the
    // account finishes all three — otherwise the list still looks unworked.
    const split = splitByBinding(
      [row("6790899405", "a"), row("6790899405", "b"), row("4130140299", "c")],
      new Map([["6790899405", owner()]])
    );
    expect(split.outsideRound.map((t) => t.id)).toEqual(["a", "b"]);
    expect(split.unknown.map((t) => t.id)).toEqual(["c"]);
  });

  it("says nothing about an empty round", () => {
    const split = splitByBinding([], new Map([["6790899405", owner()]]));
    expect(split.unknown).toHaveLength(0);
    expect(split.outsideRound).toHaveLength(0);
  });
});
