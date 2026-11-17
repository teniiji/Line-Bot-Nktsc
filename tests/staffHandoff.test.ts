import { describe, expect, it } from "vitest";
import {
  dueForReminder,
  handoffNoticeMessage,
  isOfficeHours,
  needsNewNotice,
  parseClaimPostback,
  claimPostbackData,
  workingMinutesBetween,
} from "../lib/staffHandoff";

// Bangkok wall-clock time → instant. 2026-11-13 is a Friday, 11-16 a Monday.
const bkk = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 10, day, hh - 7, mm));

describe("office hours", () => {
  it("is open Monday to Friday 08:30-16:30 Bangkok time", () => {
    expect(isOfficeHours(bkk(16, 8, 30))).toBe(true);
    expect(isOfficeHours(bkk(16, 8, 29))).toBe(false);
    expect(isOfficeHours(bkk(13, 16, 29))).toBe(true);
    expect(isOfficeHours(bkk(13, 16, 30))).toBe(false);
    expect(isOfficeHours(bkk(14, 10))).toBe(false); // Saturday
  });

  it("counts only working minutes, across a weekend", () => {
    expect(workingMinutesBetween(bkk(16, 9), bkk(16, 11))).toBe(120);
    // Friday 16:00 → Monday 09:00: 30 minutes on Friday, 30 on Monday.
    expect(workingMinutesBetween(bkk(13, 16), bkk(16, 9))).toBe(60);
    // Saturday night → Monday 10:30
    expect(workingMinutesBetween(bkk(14, 22), bkk(16, 10, 30))).toBe(120);
    expect(workingMinutesBetween(bkk(16, 11), bkk(16, 9))).toBe(0);
  });
});

describe("when a member's messages make a new notice", () => {
  const now = bkk(16, 10);
  it("notifies the first time", () => {
    expect(needsNewNotice(null, now)).toBe(true);
  });
  it("does not notify again while one is still open", () => {
    expect(needsNewNotice({ status: "open", createdAt: bkk(16, 9), claimedAt: null }, now)).toBe(false);
  });
  it("leaves follow-ups to the officer who claimed it, for a few hours", () => {
    expect(needsNewNotice({ status: "claimed", createdAt: bkk(16, 8), claimedAt: bkk(16, 9) }, now)).toBe(false);
    expect(needsNewNotice({ status: "claimed", createdAt: bkk(16, 8), claimedAt: bkk(16, 5) }, now)).toBe(true);
  });
  it("notifies again once an unclaimed notice is half a day old", () => {
    expect(needsNewNotice({ status: "open", createdAt: bkk(15, 20), claimedAt: null }, now)).toBe(true);
  });
});

describe("reminders", () => {
  const open = { status: "open", createdAt: bkk(16, 8, 45), remindedAt: null, reminderCount: 0 };
  it("reminds after two working hours unclaimed", () => {
    expect(dueForReminder(open, bkk(16, 10, 30))).toBe(false);
    expect(dueForReminder(open, bkk(16, 10, 45))).toBe(true);
  });
  it("does not remind out of hours, once claimed, or past the limit", () => {
    expect(dueForReminder(open, bkk(16, 17))).toBe(false);
    expect(dueForReminder({ ...open, status: "claimed" }, bkk(16, 11))).toBe(false);
    expect(dueForReminder({ ...open, reminderCount: 2 }, bkk(16, 15))).toBe(false);
  });
  it("counts from the last reminder", () => {
    expect(dueForReminder({ ...open, remindedAt: bkk(16, 11), reminderCount: 1 }, bkk(16, 12))).toBe(false);
    expect(dueForReminder({ ...open, remindedAt: bkk(16, 11), reminderCount: 1 }, bkk(16, 13))).toBe(true);
  });
});

describe("the notice", () => {
  it("carries a claim button for this handoff", () => {
    const msg = handoffNoticeMessage({
      id: "h1",
      memberName: "นางสาวทดสอบ",
      memberNumber: "31744",
      displayName: "ครูแอน",
      kind: "money_dispute",
      department: "บัญชี",
      reason: "แจ้งว่าโอนชำระหักไม่ได้แล้วยอดไม่เข้า",
      createdAt: bkk(16, 9),
    });
    expect(msg.altText).toContain("นางสาวทดสอบ (เลขสมาชิก 31744)");
    const json = JSON.stringify(msg);
    expect(json).toContain(claimPostbackData("h1"));
    expect(json).toContain("ร้องเรียน");
    expect(parseClaimPostback(claimPostbackData("h1"))).toBe("h1");
    expect(parseClaimPostback("other")).toBeNull();
  });
});
