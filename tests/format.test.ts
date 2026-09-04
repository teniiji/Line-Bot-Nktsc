import { describe, expect, it } from "vitest";
import {
  formatStatementDate,
  formatStatementDateTime,
  formatStatementTime,
} from "../lib/format";

describe("formatStatementDate", () => {
  it("shows the Buddhist-era date the bank printed", () => {
    expect(formatStatementDate("2026-08-31T14:32:00.000Z")).toContain("2569");
    expect(formatStatementDate("2026-08-31T14:32:00.000Z")).toContain("31");
  });

  it("does not slide the date into a neighbouring day", () => {
    // Read in the viewer's timezone, a late-evening transfer on the 31st
    // would show as the 1st — on a month-end round that is the difference
    // between paying on time and paying late.
    expect(formatStatementDate("2026-08-31T23:50:00.000Z")).toContain("31");
    expect(formatStatementDate("2026-08-31T00:10:00.000Z")).toContain("31");
  });

  it("says so plainly when there is no date", () => {
    expect(formatStatementDate(null)).toBe("—");
    expect(formatStatementDate("ไม่ใช่วันที่")).toBe("—");
  });
});

describe("formatStatementTime", () => {
  it("shows the clock reading the bank printed, in 24-hour form", () => {
    expect(formatStatementTime("2026-08-31T14:32:00.000Z")).toBe("14:32 น.");
    expect(formatStatementTime("2026-08-31T09:05:00.000Z")).toBe("09:05 น.");
  });

  it("stays empty when the export carried no time", () => {
    expect(formatStatementTime("2026-08-31T00:00:00.000Z")).toBe("");
    expect(formatStatementTime(null)).toBe("");
  });
});

describe("formatStatementDateTime", () => {
  it("puts both together when there is a time", () => {
    const both = formatStatementDateTime("2026-08-31T14:32:00.000Z");
    expect(both).toContain("2569");
    expect(both).toContain("14:32 น.");
  });

  it("falls back to the date alone", () => {
    expect(formatStatementDateTime("2026-08-31T00:00:00.000Z")).not.toContain(":");
  });
});
