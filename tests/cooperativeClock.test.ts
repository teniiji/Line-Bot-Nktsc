import { describe, expect, it } from "vitest";
import {
  COOPERATIVE_OFFSET_MS,
  cooperativeDateTime,
  cooperativeNow,
  cooperativeToday,
  dayStart,
  endOfMonth,
  monthWindow,
  shiftDay,
  startOfMonth,
} from "../lib/cooperativeClock";

describe("cooperativeToday", () => {
  it("is still yesterday's date in UTC at two in the morning in Thailand", () => {
    // The bug this file exists for: 02:00 on 11 September in Nong Khai is
    // 19:00 on the 10th in UTC, and every day boundary in the system is read
    // in UTC. A slip filed at that moment was filed against the 10th.
    const instant = new Date("2026-09-10T19:00:00.000Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(cooperativeToday(instant)).toBe("2026-09-11");
  });

  it("agrees with UTC for the rest of the day", () => {
    expect(cooperativeToday(new Date("2026-09-11T08:30:00.000Z"))).toBe("2026-09-11");
    expect(cooperativeToday(new Date("2026-09-11T16:59:59.000Z"))).toBe("2026-09-11");
  });

  it("turns over at midnight in Thailand, not at midnight in UTC", () => {
    // 17:00Z is exactly midnight in Nong Khai.
    expect(cooperativeToday(new Date("2026-09-11T16:59:59.999Z"))).toBe("2026-09-11");
    expect(cooperativeToday(new Date("2026-09-11T17:00:00.000Z"))).toBe("2026-09-12");
  });
});

describe("cooperativeNow", () => {
  it("is the wall clock, held in UTC, like a statement timestamp", () => {
    // 19:00Z is 02:00 the next morning in Nong Khai, and that is what the
    // stored value reads as.
    const stored = cooperativeNow(new Date("2026-09-10T19:00:00.000Z"));
    expect(stored.toISOString()).toBe("2026-09-11T02:00:00.000Z");
  });

  it("is seven hours, which is what Thailand has been since 1955", () => {
    expect(COOPERATIVE_OFFSET_MS).toBe(7 * 60 * 60 * 1000);
  });
});

describe("shiftDay", () => {
  it("counts back a week's worth of days", () => {
    // "7 วันล่าสุด" is today and the six before it.
    expect(shiftDay("2026-09-11", -6)).toBe("2026-09-05");
  });

  it("crosses a month end", () => {
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses a leap day", () => {
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("hands back a day it cannot read rather than an Invalid Date", () => {
    expect(shiftDay("ไม่ใช่วันที่", -1)).toBe("ไม่ใช่วันที่");
  });
});

describe("startOfMonth / endOfMonth", () => {
  it("covers a whole month, including the short ones", () => {
    expect(startOfMonth("2026-09-11")).toBe("2026-09-01");
    expect(endOfMonth("2026-09-11")).toBe("2026-09-30");
    expect(endOfMonth("2026-02-14")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-14")).toBe("2028-02-29");
    expect(endOfMonth("2026-12-31")).toBe("2026-12-31");
  });

  it("finds last month from this one", () => {
    // How the "เดือนที่แล้ว" preset is built: the day before this month began.
    const lastDay = shiftDay(startOfMonth("2026-09-11"), -1);
    expect(lastDay).toBe("2026-08-31");
    expect(startOfMonth(lastDay)).toBe("2026-08-01");
  });

  it("crosses a year without going back to January", () => {
    const lastDay = shiftDay(startOfMonth("2026-01-07"), -1);
    expect(lastDay).toBe("2025-12-31");
    expect(startOfMonth(lastDay)).toBe("2025-12-01");
  });
});

describe("monthWindow", () => {
  it("is half-open, so the last day of the month counts", () => {
    // The whole of 30 September belongs to September; 1 October does not.
    const window = monthWindow("2026-09-11");
    expect(window?.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(window?.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("says nothing for a day it cannot read", () => {
    expect(monthWindow("")).toBeNull();
  });
});

describe("dayStart", () => {
  it("is the instant the cooperative's day begins, as stored", () => {
    expect(dayStart("2026-09-11")?.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("refuses a day it cannot read", () => {
    expect(dayStart("2026-13-45")).toBeNull();
    expect(dayStart("เมื่อวาน")).toBeNull();
  });
});

describe("the day a transaction lands on", () => {
  // What the whole change is for, put end to end: a slip filed at 02:00 in
  // Nong Khai must be found by the filter for that day, not the one before.
  const filed = new Date("2026-09-10T19:00:00.000Z");
  const stored = cooperativeNow(filed);

  it("is inside the day the member sent it", () => {
    const start = dayStart("2026-09-11")!;
    const end = dayStart("2026-09-12")!;
    expect(stored >= start && stored < end).toBe(true);
  });

  it("is not inside the day before", () => {
    const start = dayStart("2026-09-10")!;
    const end = dayStart("2026-09-11")!;
    expect(stored >= start && stored < end).toBe(false);
  });
});

describe("cooperativeDateTime", () => {
  it("writes a real instant as the clock in the office read", () => {
    // 03:23Z is 10:23 in the morning in Nong Khai — the time on the message
    // an officer is sent, which must not be the server's idea of it.
    expect(cooperativeDateTime(new Date("2026-09-04T03:23:00.000Z"))).toContain("10:23");
  });

  it("keeps a late-evening instant on its own day", () => {
    // 16:30Z is 23:30 the same night, not the next morning.
    const out = cooperativeDateTime(new Date("2026-09-04T16:30:00.000Z"));
    expect(out).toContain("23:30");
    expect(out).toContain("4");
  });
});
