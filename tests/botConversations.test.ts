import { describe, expect, it } from "vitest";
import { buildThreads, filterThreads, flagOf } from "../lib/botConversations";

const at = (min: number) => new Date(Date.UTC(2026, 10, 16, 2, min)).toISOString();

describe("bot conversation threads", () => {
  const rows = [
    { id: "1", lineUserId: "U1", fromBot: false, text: "ดอกเบี้ยเงินฝากเท่าไหร่คะ", createdAt: at(0) },
    { id: "2", lineUserId: "U1", fromBot: true, text: "ออมทรัพย์ 1.5% ต่อปีค่ะ", createdAt: at(1) },
    { id: "3", lineUserId: "U2", fromBot: false, text: "โอนแล้วเงินไม่เข้า", createdAt: at(2) },
    { id: "4", lineUserId: "U2", fromBot: false, text: "ช่วยดูหน่อยค่ะ", createdAt: at(5) },
    { id: "5", lineUserId: "U1", fromBot: false, text: "มีกิจกรรมวันครูไหม", createdAt: at(6) },
    { id: "6", lineUserId: "U1", fromBot: true, text: "ขอโทษค่ะ ไม่มีข้อมูลนี้ในระบบ แนะนำให้โทร…", createdAt: at(7) },
  ];
  const members = new Map([["U1", { name: "นางสาวทดสอบ", memberNumber: "31744" }]]);
  const threads = buildThreads(rows, members);

  it("groups by member, newest thread first, messages in time order", () => {
    expect(threads.map((t) => t.lineUserId)).toEqual(["U1", "U2"]);
    expect(threads[0].messages.map((m) => m.id)).toEqual(["1", "2", "5", "6"]);
    expect(threads[0].name).toBe("นางสาวทดสอบ");
  });

  it("marks a member message the bot did not answer, but not the last one", () => {
    expect(threads[1].messages.map((m) => m.flag)).toEqual(["unanswered", null]);
    expect(threads[1].unanswered).toBe(1);
  });

  it("marks failures and gaps in the knowledge base", () => {
    expect(flagOf({ fromBot: true, text: "ขอโทษค่ะ ไม่สามารถตอบได้ในตอนนี้" })).toBe("failed");
    expect(threads[0].noInfo).toBe(1);
  });

  it("filters by flag and by name, number or text", () => {
    expect(filterThreads(threads, "unanswered", "").map((t) => t.lineUserId)).toEqual(["U2"]);
    expect(filterThreads(threads, "all", "31744").map((t) => t.lineUserId)).toEqual(["U1"]);
    expect(filterThreads(buildThreads(rows, new Map([["U2", { name: null, memberNumber: "A12" }]])), "all", "a12").map((t) => t.lineUserId)).toEqual(["U2"]);
    expect(filterThreads(threads, "all", "เงินไม่เข้า").map((t) => t.lineUserId)).toEqual(["U2"]);
  });
});
