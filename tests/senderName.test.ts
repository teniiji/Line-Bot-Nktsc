import { describe, expect, it } from "vitest";
import { cleanSenderName, firstName, nameKey, sameName } from "../lib/senderName";

describe("a sender's name against the register", () => {
  it("reads two spellings of one name as the same", () => {
    expect(nameKey("นางสาว สุพัตรา  หิรัญบูรณะ")).toBe(nameKey("น.ส.สุพัตรา หิรัญบูรณะ"));
    expect(nameKey("นาย วัน จันทร์อ่อน")).toBe(nameKey("วัน จันทร์อ่อน"));
    expect(nameKey("ว่าที่ร้อยตรีณัฐพล บุญเวิน")).toBe(nameKey("ณัฐพล บุญเวิน"));
  });

  it("takes the first name past the title", () => {
    expect(firstName("นางสาวสุพัตรา หิรัญบูรณะ")).toBe("สุพัตรา");
    expect(firstName("นาย วัน จันทร์อ่อน")).toBe("วัน");
    expect(firstName("")).toBeNull();
  });

  it("finds members whose name is the sender's", () => {
    const roster = [
      { memberNumber: "13003", memberName: "นางสาวสุพัตรา หิรัญบูรณะ" },
      { memberNumber: "13004", memberName: "นางสาวสุพัตรา ใจดี" },
    ];
    expect(sameName("น.ส. สุพัตรา หิรัญบูรณะ", roster).map((r) => r.memberNumber)).toEqual(["13003"]);
    // Too little to go on.
    expect(sameName("นาย ก", roster)).toEqual([]);
  });

  it("tidies what is typed", () => {
    expect(cleanSenderName("  นาย  สมชาย   ใจดี ")).toBe("นาย สมชาย ใจดี");
    expect(cleanSenderName("   ")).toBeNull();
  });
});
