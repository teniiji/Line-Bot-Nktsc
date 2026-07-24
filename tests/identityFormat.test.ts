import { describe, expect, it } from "vitest";
import { parseNationalId, parsePhone } from "../lib/identityFormat";

describe("parseNationalId", () => {
  it("accepts a clean 13-digit ID", () => {
    expect(parseNationalId("1234567890123")).toBe("1234567890123");
  });

  it("strips dashes/spaces before checking length", () => {
    expect(parseNationalId("1-2345-67890-12-3")).toBe("1234567890123");
  });

  it("rejects anything not exactly 13 digits", () => {
    expect(parseNationalId("123456789012")).toBeNull();
    expect(parseNationalId("12345678901234")).toBeNull();
  });

  it("treats empty/null/undefined as null", () => {
    expect(parseNationalId(null)).toBeNull();
    expect(parseNationalId(undefined)).toBeNull();
    expect(parseNationalId("")).toBeNull();
  });
});

describe("parsePhone", () => {
  it("accepts a clean 10-digit number", () => {
    expect(parsePhone("0812345678")).toBe("0812345678");
  });

  it("restores a dropped leading zero on a 9-digit number", () => {
    expect(parsePhone("812345678")).toBe("0812345678");
  });

  it("strips dashes/spaces before checking length", () => {
    expect(parsePhone("081-234-5678")).toBe("0812345678");
  });

  it("rejects lengths that aren't 9 or 10 digits", () => {
    expect(parsePhone("12345")).toBeNull();
    expect(parsePhone("081234567890123")).toBeNull();
  });

  it("treats empty/null/undefined as null", () => {
    expect(parsePhone(null)).toBeNull();
    expect(parsePhone(undefined)).toBeNull();
    expect(parsePhone("")).toBeNull();
  });
});
