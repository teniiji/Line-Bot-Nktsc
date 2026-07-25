import { describe, expect, it } from "vitest";
import { formatFormLinks } from "../lib/formLinks";

describe("formatFormLinks", () => {
  it("formats each entry as a bullet line", () => {
    const text = formatFormLinks([
      { label: "แบบฟอร์มกู้เงินสามัญ", url: "https://drive.google.com/a" },
      { label: "ใบสมัครสมาชิก", url: "https://drive.google.com/b" },
    ]);
    expect(text).toBe(
      "- แบบฟอร์มกู้เงินสามัญ: https://drive.google.com/a\n- ใบสมัครสมาชิก: https://drive.google.com/b"
    );
  });

  it("returns an empty string for no entries", () => {
    expect(formatFormLinks([])).toBe("");
  });
});
