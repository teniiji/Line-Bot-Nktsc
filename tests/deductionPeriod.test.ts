import { describe, expect, it } from "vitest";
import { parseDeductionPeriod, describeDeductionPeriod, periodOfDate } from "../lib/deductionPeriod";

describe("parseDeductionPeriod", () => {
  it("reads MMYY as a month plus a Buddhist-era year", () => {
    expect(parseDeductionPeriod("0969")).toEqual({ month: 9, year: 2569 });
    expect(parseDeductionPeriod("0170")).toEqual({ month: 1, year: 2570 });
    expect(parseDeductionPeriod("1269")).toEqual({ month: 12, year: 2569 });
  });

  it("rejects anything that isn't four digits", () => {
    for (const bad of ["", "969", "09690", "9/69", "กย69", "09 69"]) {
      expect(parseDeductionPeriod(bad)).toBeNull();
    }
  });

  it("rejects impossible months rather than producing a nonexistent one", () => {
    expect(parseDeductionPeriod("0069")).toBeNull();
    expect(parseDeductionPeriod("1369")).toBeNull();
  });
});

describe("describeDeductionPeriod", () => {
  it("labels a round in Thai", () => {
    expect(describeDeductionPeriod("0969")).toBe("กันยายน 2569");
    expect(describeDeductionPeriod("0169")).toBe("มกราคม 2569");
    expect(describeDeductionPeriod("1269")).toBe("ธันวาคม 2569");
  });

  it("returns empty rather than a wrong label for an invalid code", () => {
    expect(describeDeductionPeriod("1369")).toBe("");
    expect(describeDeductionPeriod("abc")).toBe("");
  });
});

describe("periodOfDate", () => {
  it("is the inverse of parseDeductionPeriod for an ordinary date", () => {
    expect(periodOfDate(new Date("2026-09-22T12:25:00.000Z"))).toBe("0969");
    expect(periodOfDate(new Date("2026-08-20T12:19:00.000Z"))).toBe("0869");
    expect(periodOfDate(new Date("2027-01-05T00:00:00.000Z"))).toBe("0170");
  });

  it("reads UTC getters directly rather than shifting by the cooperative offset", () => {
    // Stored transaction dates are already Thai wall clock written as UTC
    // (lib/cooperativeClock.ts) — a payment recorded at 23:50 stays in the
    // same month it was posted in, not pushed into the next day by a second
    // +7 hour shift.
    expect(periodOfDate(new Date("2026-08-31T23:50:00.000Z"))).toBe("0869");
  });

  it("round-trips through describeDeductionPeriod", () => {
    const period = periodOfDate(new Date("2026-09-22T12:25:00.000Z"));
    expect(describeDeductionPeriod(period)).toBe("กันยายน 2569");
  });
});
