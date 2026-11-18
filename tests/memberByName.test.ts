import { describe, expect, it } from "vitest";
import { memberNumberByName } from "../lib/memberByName";
import { memberNumberProblem, notMemberNumberKind } from "../lib/memberIdentity";

const row = (memberNumber: string, memberName: string, lineUserId: string | null = null) => ({
  memberNumber,
  memberName,
  lineUserId,
});

describe("finding a member's number from their name", () => {
  it("takes the one register row with the name, whatever the title or spacing", () => {
    expect(
      memberNumberByName({
        fullName: "นางอรุณี  ประจิมทิศ",
        lineUserId: "U1",
        roster: [row("24794", "อรุณี ประจิมทิศ"), row("11111", "อรุณี ประจิม")],
        depositMembers: [],
      })
    ).toBe("24794");
  });

  it("settles two members of the same name by earlier deposits to the account", () => {
    const roster = [row("100", "นางอรุณี ประจิมทิศ"), row("200", "นางอรุณี ประจิมทิศ")];
    expect(memberNumberByName({ fullName: "อรุณี ประจิมทิศ", lineUserId: "U1", roster, depositMembers: [] })).toBeNull();
    expect(memberNumberByName({ fullName: "อรุณี ประจิมทิศ", lineUserId: "U1", roster, depositMembers: ["200"] })).toBe("200");
  });

  it("never takes a row that belongs to another LINE account, or a too-short name", () => {
    expect(
      memberNumberByName({ fullName: "อรุณี ประจิมทิศ", lineUserId: "U1", roster: [row("100", "อรุณี ประจิมทิศ", "U9")], depositMembers: [] })
    ).toBeNull();
    expect(memberNumberByName({ fullName: "นาง อร", lineUserId: "U1", roster: [row("1", "อร")], depositMembers: [] })).toBeNull();
  });
});

describe("what is not a member number", () => {
  it("refuses a phone number or a deposit account", () => {
    expect(notMemberNumberKind("081-7691294")).toBe("phone");
    expect(notMemberNumberKind("817691294")).toBe("phone"); // leading zero already stripped
    expect(notMemberNumberKind("300-00-24794")).toBe("account");
    expect(notMemberNumberKind("3000024794")).toBe("account");
    expect(memberNumberProblem("081769124")).not.toBeNull();
  });

  it("accepts real member numbers", () => {
    for (const n of ["31744", "25686", "900123", "1234567"]) {
      expect(memberNumberProblem(n)).toBeNull();
    }
  });
});
