import { describe, expect, it } from "vitest";
import { rosterCanVerify } from "../lib/lookupReadiness";

describe("rosterCanVerify", () => {
  it("is false when the roster carries neither field", () => {
    // A roster imported from round lists alone: names and numbers, nothing to
    // verify against. Asking a member for their national ID here sets a test
    // with no pass.
    expect(
      rosterCanVerify([
        { nationalId: null, phone: null },
        { nationalId: null, phone: null },
      ])
    ).toBe(false);
  });

  it("is false when rows have one field but never both", () => {
    // matchesIdentity refuses a row missing either, so half a record verifies
    // nobody.
    expect(
      rosterCanVerify([
        { nationalId: "3430100123456", phone: null },
        { nationalId: null, phone: "0812345678" },
      ])
    ).toBe(false);
  });

  it("is true as soon as one row could be matched", () => {
    // One is enough: the question is whether the check is answerable at all,
    // not how many people it can answer for.
    expect(
      rosterCanVerify([
        { nationalId: null, phone: null },
        { nationalId: "3430100123456", phone: "0812345678" },
      ])
    ).toBe(true);
  });

  it("does not count whitespace as a record", () => {
    expect(rosterCanVerify([{ nationalId: "   ", phone: "0812345678" }])).toBe(false);
  });

  it("is false for an empty roster", () => {
    expect(rosterCanVerify([])).toBe(false);
  });
});
