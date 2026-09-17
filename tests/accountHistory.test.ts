import { describe, expect, it } from "vitest";
import { fillAccounts } from "../lib/accountHistory";

const account = (memberNumber: string, accountNumber: string) => ({ memberNumber, accountNumber });
const historic = (memberNumber: string, accountNumber: string, rank: number) => ({
  memberNumber,
  accountNumber,
  rank,
});

describe("fillAccounts", () => {
  it("takes a binding somebody made by hand", () => {
    const { fills } = fillAccounts(["21064"], [account("21064", "4131234567")], []);
    expect(fills).toEqual([
      { memberNumber: "21064", accountNumber: "4131234567", source: "directory" },
    ]);
  });

  it("falls back to the last round that carried one", () => {
    // The gap this exists for: a round's sheet can carry เลขบัญชี, and that
    // column never reached the directory — so a member whose account was in
    // August's file read as "ไม่มีเลขบัญชี" in September, from a file whose
    // template has no account column at all.
    const { fills } = fillAccounts(["21064"], [], [historic("21064", "4131234567", 3)]);
    expect(fills).toEqual([
      { memberNumber: "21064", accountNumber: "4131234567", source: "previous" },
    ]);
  });

  it("prefers the directory over any round", () => {
    const { fills } = fillAccounts(
      ["21064"],
      [account("21064", "4130000001")],
      [historic("21064", "4139999999", 9)]
    );
    expect(fills[0]).toMatchObject({ accountNumber: "4130000001", source: "directory" });
  });

  it("takes the most recent round, not the longest-standing account", () => {
    const { fills } = fillAccounts(
      ["21064"],
      [],
      [
        historic("21064", "4130000001", 1),
        historic("21064", "4130000009", 5),
        historic("21064", "4130000003", 3),
      ]
    );
    expect(fills[0].accountNumber).toBe("4130000009");
  });

  it("refuses to choose when the directory knows two", () => {
    const { fills, ambiguous } = fillAccounts(
      ["21064"],
      [account("21064", "4130000001"), account("21064", "4470000002")],
      []
    );
    expect(fills).toHaveLength(0);
    expect(ambiguous).toEqual(["21064"]);
  });

  it("refuses to choose when one round carried two", () => {
    // Two rows for the same member in the same month, disagreeing. Picking
    // one is how money gets matched to the wrong half of somebody's banking.
    const { fills, ambiguous } = fillAccounts(
      ["21064"],
      [],
      [historic("21064", "4130000001", 4), historic("21064", "4470000002", 4)]
    );
    expect(fills).toHaveLength(0);
    expect(ambiguous).toEqual(["21064"]);
  });

  it("leaves a member nobody has ever recorded alone", () => {
    const { fills, ambiguous } = fillAccounts(["99999"], [], []);
    expect(fills).toHaveLength(0);
    expect(ambiguous).toHaveLength(0);
  });

  it("fills a whole round's worth, each from its own best source", () => {
    const { fills } = fillAccounts(
      ["1", "2", "3"],
      [account("1", "4130000001")],
      [historic("2", "4130000002", 7)]
    );
    expect(fills).toEqual([
      { memberNumber: "1", accountNumber: "4130000001", source: "directory" },
      { memberNumber: "2", accountNumber: "4130000002", source: "previous" },
    ]);
  });
});
