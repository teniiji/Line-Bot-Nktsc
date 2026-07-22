import { describe, expect, it } from "vitest";
import { matchesIdentity } from "../lib/memberLookup";

const roster = {
  memberName: "นางสาวสมหญิง ใจดี",
  nationalId: "1-2345-67890-12-3",
  phone: "081-234-5678",
};

describe("matchesIdentity", () => {
  it("matches when all three fields correspond, ignoring formatting/honorifics", () => {
    expect(
      matchesIdentity(roster, {
        fullName: "สมหญิง ใจดี",
        nationalId: "1234567890123",
        phone: "0812345678",
      })
    ).toBe(true);
  });

  it("rejects a wrong national ID even if name and phone match", () => {
    expect(
      matchesIdentity(roster, {
        fullName: "สมหญิง ใจดี",
        nationalId: "9999999999999",
        phone: "0812345678",
      })
    ).toBe(false);
  });

  it("rejects a wrong phone even if name and national ID match", () => {
    expect(
      matchesIdentity(roster, {
        fullName: "สมหญิง ใจดี",
        nationalId: "1234567890123",
        phone: "0899999999",
      })
    ).toBe(false);
  });

  it("rejects a clearly different name even with correct ID and phone", () => {
    expect(
      matchesIdentity(roster, {
        fullName: "สมชาย รักเรียน",
        nationalId: "1234567890123",
        phone: "0812345678",
      })
    ).toBe(false);
  });

  it("never matches on empty claimed fields, unlike namesLikelyMatch's own leniency", () => {
    expect(
      matchesIdentity(roster, { fullName: "", nationalId: "1234567890123", phone: "0812345678" })
    ).toBe(false);
  });

  it("never matches when the roster record itself is missing nationalId/phone", () => {
    const incompleteRoster = { memberName: "สมหญิง ใจดี", nationalId: null, phone: "0812345678" };
    expect(
      matchesIdentity(incompleteRoster, {
        fullName: "สมหญิง ใจดี",
        nationalId: "1234567890123",
        phone: "0812345678",
      })
    ).toBe(false);
  });
});
