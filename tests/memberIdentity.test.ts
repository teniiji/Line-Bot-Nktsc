import { describe, expect, it } from "vitest";
import {
  askForMissingIdentity,
  memberNumberProblem,
  mergeIdentity,
  statedMemberNumber,
  statedValue,
} from "../lib/memberIdentity";

const nothingSaved = { fullName: null, memberNumber: null };

describe("statedValue", () => {
  it("keeps what the member actually said", () => {
    expect(statedValue("นางพิศวง พรหมจรรย์")).toBe("นางพิศวง พรหมจรรย์");
    expect(statedValue("  29252  ")).toBe("29252");
  });

  it("treats a placeholder as not given, so it can never be stored", () => {
    // The original incident: the schema required both fields, so the model
    // filled the missing one with "<UNKNOWN>" and it was saved as if real.
    expect(statedValue("<UNKNOWN>")).toBeNull();
    expect(statedValue("ไม่ทราบ")).toBeNull();
    expect(statedValue("-")).toBeNull();
    expect(statedValue("")).toBeNull();
    expect(statedValue(undefined)).toBeNull();
  });
});

describe("mergeIdentity", () => {
  it("keeps the number given now and asks only for the name", () => {
    // 10:56 — "เลขที่สมาชิกสหกรณ์ 29252ค่ะ". This used to be thrown away.
    const merge = mergeIdentity({ fullName: null, memberNumber: "29252" }, nothingSaved);
    expect(merge).toEqual({ fullName: null, memberNumber: "29252", missing: "fullName" });
  });

  it("completes the identity when the name arrives a message later", () => {
    // 10:57 — "ฉันชื่อนางพิศวง พรหมจรรย์ค่ะ", with the number already saved.
    const merge = mergeIdentity(
      { fullName: "นางพิศวง พรหมจรรย์", memberNumber: null },
      { fullName: null, memberNumber: "29252" }
    );
    expect(merge).toEqual({
      fullName: "นางพิศวง พรหมจรรย์",
      memberNumber: "29252",
      missing: null,
    });
  });

  it("never blanks a saved piece the member did not repeat", () => {
    // The rule that must not bend: forgetting the name here would restart the
    // same loop from the other direction.
    const merge = mergeIdentity(
      { fullName: null, memberNumber: "29252" },
      { fullName: "นางพิศวง พรหมจรรย์", memberNumber: null }
    );
    expect(merge.fullName).toBe("นางพิศวง พรหมจรรย์");
    expect(merge.missing).toBeNull();
  });

  it("lets a member correct a piece already on record", () => {
    const merge = mergeIdentity(
      { fullName: "นางพิศวง พรหมจรรย์", memberNumber: null },
      { fullName: "พิศวง", memberNumber: "29252" }
    );
    expect(merge.fullName).toBe("นางพิศวง พรหมจรรย์");
  });

  it("reports both missing when the tool was called with nothing", () => {
    expect(mergeIdentity(nothingSaved, nothingSaved).missing).toBe("both");
  });
});

describe("askForMissingIdentity", () => {
  it("names the piece still needed and says the other is already held", () => {
    // Being asked twice for something just given is what made the member
    // write "สลิปก็ส่งให้แล้ว ไม่เข้าใจคือว่าไรคะ".
    const text = askForMissingIdentity(
      mergeIdentity({ fullName: null, memberNumber: "29252" }, nothingSaved)
    );
    expect(text).toContain("29252");
    expect(text).toContain("ชื่อ-นามสกุล");
    expect(text).toContain("already on record");
  });

  it("asks only for the number when the name is held", () => {
    const text = askForMissingIdentity(
      mergeIdentity({ fullName: "นางพิศวง พรหมจรรย์", memberNumber: null }, nothingSaved)
    );
    expect(text).toContain("นางพิศวง พรหมจรรย์");
    expect(text).toContain("เลขสมาชิก");
  });

  it("asks for both only when nothing at all is known", () => {
    const text = askForMissingIdentity(mergeIdentity(nothingSaved, nothingSaved));
    expect(text).toContain("ชื่อ-นามสกุล");
    expect(text).toContain("เลขสมาชิก");
  });
});

describe("memberNumberProblem", () => {
  it("refuses a 13-digit national ID", () => {
    // The mistake it exists for: a member answering the lookup flow's
    // questions (name + national ID + phone) got them filed through
    // submit_member_info, and the ID was saved as a member number. Staff
    // reading an ID card copy can slip the same way, so both ask here.
    expect(memberNumberProblem("1234567890123")).not.toBeNull();
    expect(memberNumberProblem("1234567890123")).toContain("เลขประจำตัวประชาชน");
  });

  it("accepts the member numbers the cooperative actually issues", () => {
    expect(memberNumberProblem("29252")).toBeNull();
    expect(memberNumberProblem("30051")).toBeNull();
    // สมาชิกสมทบ run in the 900000s.
    expect(memberNumberProblem("900123")).toBeNull();
  });

  it("does not invent a shape rule beyond the one that is proven", () => {
    // Member numbers look numeric in every sample seen, but rejecting an odd
    // one would block a real member; a person can see and correct it, whereas
    // a wrongly refused number just stops the work.
    expect(memberNumberProblem("29252-1")).toBeNull();
  });

  it("does not refuse a 13-character value that is not all digits", () => {
    // The rule is about national IDs specifically, not about length.
    expect(memberNumberProblem("29252/2569-01")).toBeNull();
  });
});

describe("statedMemberNumber", () => {
  it("stores a stated number the one way the database holds it", () => {
    // A member typing "029262" and a หักไม่ได้ sheet saying "29262" used to
    // become two members: the reconciliation refused to pair her payment, and
    // every roster lookup for the padded form found nothing, so her
    // transactions were filed as unverified.
    expect(statedMemberNumber("029262")).toBe("29262");
    expect(statedMemberNumber("  029262 ")).toBe("29262");
  });

  it("leaves an ordinary number alone", () => {
    expect(statedMemberNumber("29262")).toBe("29262");
    expect(statedMemberNumber("900123")).toBe("900123");
  });

  it("still refuses a placeholder, exactly as statedValue does", () => {
    // The rule this wraps must not weaken: "<UNKNOWN>" was once saved as if a
    // real number, and canonicalising it would only have made it tidier.
    expect(statedMemberNumber("<UNKNOWN>")).toBeNull();
    expect(statedMemberNumber("ไม่ทราบ")).toBeNull();
    expect(statedMemberNumber("")).toBeNull();
    expect(statedMemberNumber(undefined)).toBeNull();
  });

  it("does not touch anything but leading zeros", () => {
    expect(statedMemberNumber("29262-1")).toBe("29262-1");
  });
});
