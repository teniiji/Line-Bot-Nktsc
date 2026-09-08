import { describe, expect, it } from "vitest";
import { differentMembers, memberNumberKey, sameMember } from "../lib/memberNumber";

describe("memberNumberKey", () => {
  it("strips leading zeros and surrounding space", () => {
    expect(memberNumberKey("029262")).toBe("29262");
    expect(memberNumberKey("  29262 ")).toBe("29262");
    expect(memberNumberKey("0029262")).toBe("29262");
  });

  it("leaves a plain number alone", () => {
    expect(memberNumberKey("29262")).toBe("29262");
    expect(memberNumberKey("900123")).toBe("900123");
  });

  it("never strips a number down to nothing", () => {
    expect(memberNumberKey("0")).toBe("0");
    expect(memberNumberKey("000")).toBe("0");
  });

  it("has no key for a number that is not there", () => {
    expect(memberNumberKey(null)).toBeNull();
    expect(memberNumberKey(undefined)).toBeNull();
    expect(memberNumberKey("")).toBeNull();
    expect(memberNumberKey("   ")).toBeNull();
  });

  it("changes nothing but leading zeros", () => {
    // Every further normalisation is another way two genuinely different
    // members could be merged, and merging two members files one person's
    // money under another's name.
    expect(memberNumberKey("29262-1")).toBe("29262-1");
    expect(memberNumberKey("29 262")).toBe("29 262");
    expect(memberNumberKey("29262/2569")).toBe("29262/2569");
  });
});

describe("sameMember", () => {
  it("sees through a leading zero", () => {
    // 8 Sep 2026: the หักไม่ได้ sheet had "29262" for account 9825072199 and
    // the slip นางสาวภรณ์ทิพย์ sent said "029262". reconcileDay read that as
    // two different people and refused the pairing, leaving her ฿4,200 under
    // "มีสลิปแต่ไม่เจอเงินเข้า" while the money sat in the statement.
    expect(sameMember("29262", "029262")).toBe(true);
    expect(sameMember("029262", "29262")).toBe(true);
  });

  it("still tells two members apart", () => {
    expect(sameMember("29262", "29252")).toBe(false);
    expect(sameMember("29262", "292620")).toBe(false);
  });

  it("is never true when a number is missing", () => {
    // The reconciliation uses this to decide a payment IS a member's, so
    // "nothing is known" must not read as agreement.
    expect(sameMember(null, "29262")).toBe(false);
    expect(sameMember("29262", null)).toBe(false);
    expect(sameMember(null, null)).toBe(false);
    expect(sameMember("", "")).toBe(false);
  });
});

describe("differentMembers", () => {
  it("is true only when both are known and they disagree", () => {
    expect(differentMembers("29262", "29252")).toBe(true);
    expect(differentMembers("29262", "029262")).toBe(false);
  });

  it("is never true when a number is missing", () => {
    // A pairing is refused on this, and a slip with no member number cannot
    // contradict anything — refusing there would throw away a real payment.
    expect(differentMembers(null, "29262")).toBe(false);
    expect(differentMembers("29262", undefined)).toBe(false);
    expect(differentMembers(null, null)).toBe(false);
  });

  it("is the opposite of sameMember only where both are known", () => {
    expect(differentMembers("29262", "29252")).toBe(!sameMember("29262", "29252"));
    // …and deliberately not where one is missing: both are false there.
    expect(sameMember(null, "29262")).toBe(false);
    expect(differentMembers(null, "29262")).toBe(false);
  });
});
