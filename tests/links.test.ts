import { describe, expect, it, vi } from "vitest";
import { stripDisallowedLinks } from "../lib/links";

vi.spyOn(console, "warn").mockImplementation(() => {});

describe("stripDisallowedLinks", () => {
  it("leaves text without links unchanged", () => {
    const text = "ติดต่อสำนักงานได้ที่ 042-411334 ค่ะ";
    expect(stripDisallowedLinks(text)).toBe(text);
  });

  it("strips http and https links (allowlist is currently empty)", () => {
    expect(stripDisallowedLinks("ดูได้ที่ https://www.nktscoop.com นะคะ")).toBe(
      "ดูได้ที่ [ลิงก์ถูกลบเพื่อความปลอดภัย] นะคะ"
    );
    expect(stripDisallowedLinks("http://evil-gambling.example/promo")).toBe(
      "[ลิงก์ถูกลบเพื่อความปลอดภัย]"
    );
  });

  it("strips every link in a multi-link reply", () => {
    const result = stripDisallowedLinks(
      "ลิงก์แรก https://a.example/x และลิงก์สอง https://b.example/y"
    );
    expect(result).not.toContain("http");
    expect(result.match(/\[ลิงก์ถูกลบเพื่อความปลอดภัย\]/g)).toHaveLength(2);
  });

  it("is case-insensitive on the scheme", () => {
    expect(stripDisallowedLinks("HTTPS://WWW.NKTSCOOP.COM")).toBe(
      "[ลิงก์ถูกลบเพื่อความปลอดภัย]"
    );
  });

  it("does not touch bare domains without a scheme", () => {
    // LINE only auto-unfurls full http(s) URLs; bare domains are left alone.
    const text = "เว็บไซต์ www.nktscoop.com ค่ะ";
    expect(stripDisallowedLinks(text)).toBe(text);
  });
});
