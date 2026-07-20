import { describe, expect, it } from "vitest";
import { isPlaceholderText } from "../lib/placeholderText";

describe("isPlaceholderText", () => {
  it("flags common filler values the model might invent", () => {
    expect(isPlaceholderText("<UNKNOWN>")).toBe(true);
    expect(isPlaceholderText("unknown")).toBe(true);
    expect(isPlaceholderText("Unknown")).toBe(true);
    expect(isPlaceholderText("N/A")).toBe(true);
    expect(isPlaceholderText("n/a")).toBe(true);
    expect(isPlaceholderText("-")).toBe(true);
    expect(isPlaceholderText("--")).toBe(true);
    expect(isPlaceholderText("none")).toBe(true);
    expect(isPlaceholderText("null")).toBe(true);
    expect(isPlaceholderText("ไม่ทราบ")).toBe(true);
    expect(isPlaceholderText("ไม่มี")).toBe(true);
    expect(isPlaceholderText("  unknown  ")).toBe(true);
  });

  it("flags an empty or whitespace-only string", () => {
    expect(isPlaceholderText("")).toBe(true);
    expect(isPlaceholderText("   ")).toBe(true);
  });

  it("does not flag real names, member numbers, or account numbers", () => {
    expect(isPlaceholderText("สมชาย ใจดี")).toBe(false);
    expect(isPlaceholderText("พิลาสลักษณ์ สุขรมย์")).toBe(false);
    expect(isPlaceholderText("12345")).toBe(false);
    expect(isPlaceholderText("14331")).toBe(false);
    expect(isPlaceholderText("123-4-56789-0")).toBe(false);
    expect(isPlaceholderText("0812345678")).toBe(false);
  });
});
