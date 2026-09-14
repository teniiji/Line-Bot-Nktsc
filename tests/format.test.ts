import { describe, expect, it } from "vitest";
import {
  formatStatementDate,
  formatThaiDay,
  formatStatementDateTime,
  formatStatementTime,
  formatStatementTimeExact,
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

describe("formatStatementTimeExact", () => {
  it("keeps the seconds the bank printed", () => {
    // The statement table is read line by line against the bank's own
    // printout, where two postings can share a minute.
    expect(formatStatementTimeExact("2026-08-31T14:32:07.000Z")).toBe("14:32:07 น.");
    expect(formatStatementTimeExact("2026-08-31T09:05:00.000Z")).toBe("09:05:00 น.");
  });

  it("does not slide the reading into another timezone", () => {
    // Same reason as the date: statement timestamps hold the bank's wall
    // clock in UTC, so they are read back in UTC.
    expect(formatStatementTimeExact("2026-08-31T23:50:41.000Z")).toBe("23:50:41 น.");
  });

  it("stays empty when the export carried no time at all", () => {
    // Exact midnight means a date with no clock reading — showing
    // "00:00:00 น." would invent a precision the bank never supplied.
    expect(formatStatementTimeExact("2026-08-31T00:00:00.000Z")).toBe("");
    expect(formatStatementTimeExact(null)).toBe("");
    expect(formatStatementTimeExact("ไม่ใช่เวลา")).toBe("");
  });

  it("agrees with the minute-only form on everything but the seconds", () => {
    const iso = "2026-08-31T14:32:07.000Z";
    expect(formatStatementTimeExact(iso).startsWith(formatStatementTime(iso).replace(" น.", ""))).toBe(
      true
    );
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

describe("formatThaiDay", () => {
  it("reads a date box's value back in พ.ศ.", () => {
    // The boxes themselves are Gregorian and cannot be changed — the browser
    // draws them. Staff here read Buddhist years, so the reading goes beside.
    expect(formatThaiDay("2026-09-14")).toBe("14 ก.ย. 2569");
  });

  it("is 543 years ahead, every time", () => {
    expect(formatThaiDay("2026-02-01")).toContain("2569");
    expect(formatThaiDay("2025-12-31")).toContain("2568");
  });

  it("does not slide a day either way", () => {
    // Read in a timezone behind UTC, the first of the month becomes the last
    // of the previous one — which is the whole reason this reads in UTC.
    expect(formatThaiDay("2026-02-01")).toBe("1 ก.พ. 2569");
    expect(formatThaiDay("2026-12-31")).toBe("31 ธ.ค. 2569");
  });

  it("says nothing for an empty or unreadable box", () => {
    expect(formatThaiDay("")).toBe("");
    expect(formatThaiDay("ไม่ใช่วันที่")).toBe("");
  });
});
