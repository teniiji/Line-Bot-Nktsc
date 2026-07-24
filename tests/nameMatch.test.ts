import { describe, expect, it } from "vitest";
import { namesLikelyMatch } from "../lib/nameMatch";

describe("namesLikelyMatch", () => {
  it("matches identical names", () => {
    expect(namesLikelyMatch("สมชาย ใจดี", "สมชาย ใจดี")).toBe(true);
  });

  it("matches despite whitespace/spacing differences", () => {
    expect(namesLikelyMatch("สมชาย ใจดี", "สมชาย  ใจดี")).toBe(true);
    expect(namesLikelyMatch("สมชาย ใจดี", "สมชายใจดี")).toBe(true);
  });

  it("matches when one side has an honorific prefix the other lacks", () => {
    expect(namesLikelyMatch("สมชาย ใจดี", "นายสมชาย ใจดี")).toBe(true);
    expect(namesLikelyMatch("นางสาวพิลาสลักษณ์ สุขรมย์", "พิลาสลักษณ์ สุขรมย์")).toBe(true);
  });

  it("matches case-insensitively for English names", () => {
    expect(namesLikelyMatch("John Smith", "JOHN SMITH")).toBe(true);
    expect(namesLikelyMatch("Mr. John Smith", "John Smith")).toBe(true);
  });

  it("matches when one name is a substring of the other (partial/nickname cases)", () => {
    expect(namesLikelyMatch("สมชาย", "สมชาย ใจดี")).toBe(true);
  });

  it("does not flag a mismatch when either side is empty (nothing to compare)", () => {
    expect(namesLikelyMatch("", "สมชาย ใจดี")).toBe(true);
    expect(namesLikelyMatch("สมชาย ใจดี", "")).toBe(true);
  });

  it("flags clearly different names as a mismatch", () => {
    expect(namesLikelyMatch("สมชาย ใจดี", "วิภาดา ภูริ่งพลอย")).toBe(false);
    expect(namesLikelyMatch("John Smith", "Jane Doe")).toBe(false);
  });

  it("matches when the slip masks the surname but the given name matches", () => {
    expect(namesLikelyMatch("ศักดิ์สิทธิ์ โคตรวันดี", "ศักดิ์สิทธิ์ ค***")).toBe(true);
    expect(namesLikelyMatch("นายศักดิ์สิทธิ์ โคตรวันดี", "ศักดิ์สิทธิ์ ค.")).toBe(true);
    expect(namesLikelyMatch("สมชาย ใจดี", "สมชาย xx")).toBe(true);
  });

  it("still flags a mismatch when the given name differs, even with a masked surname", () => {
    expect(namesLikelyMatch("สมชาย ใจดี", "วิภาดา ภ***")).toBe(false);
  });

  it("still flags a mismatch when the surname genuinely differs and isn't masked", () => {
    expect(namesLikelyMatch("สมชาย ใจดี", "สมชาย รักชาติ")).toBe(false);
  });
});
