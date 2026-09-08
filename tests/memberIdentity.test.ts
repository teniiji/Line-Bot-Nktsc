import { describe, expect, it } from "vitest";
import { askForMissingIdentity, mergeIdentity, statedValue } from "../lib/memberIdentity";

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
