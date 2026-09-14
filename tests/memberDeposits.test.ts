import { describe, expect, it } from "vitest";
import { accountsForMember } from "../lib/memberDeposits";

const directory = [
  { accountNumber: "9825072199", memberNumber: "29252" },
  { accountNumber: "4131150069", memberNumber: "14352" },
];
const roundMembers = [
  { accountNumber: "4883387836", memberNumber: "029252" },
  { accountNumber: null, memberNumber: "29252" },
];

describe("accountsForMember", () => {
  it("gathers what both sources attribute to one member", () => {
    // The directory knows only the members somebody has bound by hand; the
    // rounds carry far more rows but go stale. Neither alone is enough.
    expect(accountsForMember([directory, roundMembers], "29252")).toEqual([
      "4883387836",
      "9825072199",
    ]);
  });

  it("reads a leading zero as the same member", () => {
    // The two sources are written by different hands. "029252" and "29252"
    // are one member — see lib/memberNumber.ts.
    expect(accountsForMember([roundMembers], "29252")).toEqual(["4883387836"]);
    expect(accountsForMember([directory], "029252")).toEqual(["9825072199"]);
  });

  it("ignores a row with no account on it", () => {
    expect(accountsForMember([roundMembers], "29252")).not.toContain(null);
  });

  it("returns nothing for a member nothing knows about", () => {
    expect(accountsForMember([directory, roundMembers], "99999")).toEqual([]);
  });

  it("returns nothing rather than everything for a blank member number", () => {
    // An empty filter that matched every account would put somebody else's
    // payments in front of staff as this member's.
    expect(accountsForMember([directory, roundMembers], "")).toEqual([]);
    expect(accountsForMember([directory, roundMembers], "   ")).toEqual([]);
  });

  it("does not list the same account twice", () => {
    const both = [{ accountNumber: "9825072199", memberNumber: "29252" }];
    expect(accountsForMember([directory, both], "29252")).toEqual(["9825072199"]);
  });
});
