import { describe, expect, it } from "vitest";
import { payerKey, splitFingerprint, splitProblem, suggestedPayerName } from "../lib/unitPayer";

describe("payerKey", () => {
  it("keeps the payer and drops the per-transfer reference", () => {
    expect(payerKey("KHON KAEN CM TA/เทศบาลนครขอนแก่น/200405")).toBe("khon kaen cm ta/เทศบาลนครขอนแก่น");
    expect(payerKey("KHON KAEN CM TA/เทศบาลนครขอนแก่น/200512")).toBe("khon kaen cm ta/เทศบาลนครขอนแก่น");
  });

  it("evens out spacing and case", () => {
    expect(payerKey("Kalasin  PESA 2 /สนง.เขตพื้นที่การศึกษาฯ")).toBe(payerKey("KALASIN PESA 2/สนง.เขตพื้นที่การศึกษาฯ"));
  });

  it("has nothing to go on for an empty or number-only description", () => {
    expect(payerKey("")).toBeNull();
    expect(payerKey("200405")).toBeNull();
  });
});

describe("suggestedPayerName", () => {
  it("offers the statement's own words", () => {
    expect(suggestedPayerName("Kalasin PESA 2/สนง.เขตพื้นที่การศึกษาฯ")).toBe("Kalasin PESA 2 / สนง.เขตพื้นที่การศึกษาฯ");
  });
});

describe("splitProblem", () => {
  it("accepts parts that add up to the line exactly", () => {
    expect(
      splitProblem(29200, [
        { memberNumber: "11111", amount: 14600 },
        { memberNumber: "22222", amount: 14600 },
      ])
    ).toBeNull();
  });

  it("says how much is left over or too much", () => {
    expect(splitProblem(29200, [{ memberNumber: "11111", amount: 14600 }])).toContain("ขาดอีก 14600.00");
    expect(
      splitProblem(1000, [
        { memberNumber: "11111", amount: 700 },
        { memberNumber: "22222", amount: 500 },
      ])
    ).toContain("เกินมา 200.00");
  });

  it("refuses a member twice, a blank member and a zero amount", () => {
    expect(
      splitProblem(200, [
        { memberNumber: "011111", amount: 100 },
        { memberNumber: "11111", amount: 100 },
      ])
    ).toContain("ซ้ำ");
    expect(splitProblem(100, [{ memberNumber: "", amount: 100 }])).toContain("เลขสมาชิก");
    expect(
      splitProblem(100, [
        { memberNumber: "11111", amount: 100 },
        { memberNumber: "22222", amount: 0 },
      ])
    ).toContain("มากกว่า 0");
    expect(splitProblem(100, [])).toBe("ยังไม่ได้ใส่สมาชิก");
  });
});

describe("splitFingerprint", () => {
  it("names the line and the member, one row per member", () => {
    expect(splitFingerprint("413|abc", "011111")).toBe("line:413|abc#11111");
  });
});
