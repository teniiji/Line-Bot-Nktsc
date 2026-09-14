import { describe, expect, it } from "vitest";
import { tools } from "../lib/agent/tools";
import { buildSystemPrompt } from "../lib/agent/prompts";

// The rule the bot follows when it decides to say nothing, checked against
// the cooperative's own record of how staff actually answer — 1,058 real LINE
// messages, summarised in the ntsc-line-qa reference. The first version of
// this rule was stricter than the people it was written to imitate.

const description = () => {
  const tool = tools.find((t) => t.name === "leave_to_staff");
  if (!tool) throw new Error("leave_to_staff is gone");
  return tool.description;
};

const prompt = () => buildSystemPrompt(null, null, null, null, "", "").base;

describe("what the bot stays silent about", () => {
  it("keeps silence for a decision that is the cooperative's to make", () => {
    expect(description()).toContain("APPROVE, WAIVE, or make an EXCEPTION");
  });

  it("keeps silence for a complaint about money that did not arrive", () => {
    // "เงินทอนทำไมไม่เข้าบัญชีคะ" — confirming or denying without checking is
    // a guess, and money is not something to guess about.
    expect(description()).toContain("complaint or dispute about money");
  });

  it("keeps silence when it does not know what is being referred to", () => {
    expect(description()).toContain("do not know what the member is referring to");
  });
});

describe("what it must answer instead of going quiet", () => {
  it("answers a member saying which day they will remit", () => {
    // The cooperative's own record: staff acknowledge these immediately,
    // without negotiating — "จะนำส่งศุกร์ที่ 25 นะคะ" → "ครับ". The first
    // version of this rule listed moving a payment date as grounds for
    // silence, which was stricter than the staff it copies.
    expect(description()).toContain("is NOT an approval request");
    expect(description()).toContain("acknowledge it briefly");
  });

  it("still treats a postponement past the deadline as staff's", () => {
    // The exception the record names: past month-end, it stops being routine.
    expect(description()).toContain("past the cooperative's own month-end deadline");
  });

  it("answers a question about the member's own borrowing limit", () => {
    // Explain what it depends on; never state the number. Going silent on it
    // was too strict — the reference data does answer half the question.
    expect(description()).toContain("explain what the figure depends on");
    expect(description()).toContain("never go silent on it");
  });

  it("says both of those in the prompt too, where the model reads them", () => {
    // The tool description is only read when the model is already looking at
    // this tool. The rule has to be in the prompt to stop it looking.
    expect(prompt()).toContain("ไม่ใช่การขออนุมัติ");
    expect(prompt()).toContain("ห้ามฟันธงตัวเลข แต่ก็ห้ามเงียบ");
  });

  it("still refuses to use silence for the flows that have their own handling", () => {
    for (const phrase of ["reference data already answers", "transfer slip", "thank-you"]) {
      expect(description(), phrase).toContain(phrase);
    }
  });
});

// A member opened with "ขอกู้ฉุกเฉินได้ไหมครับ" and got the bot's list of
// things it can help with — and then, over three more messages, was asked what
// he wanted three times. Asking to borrow is asking to use a service the
// cooperative already offers; it is not asking for an exception to a rule.
describe("asking whether they may borrow", () => {
  it("is not an approval request, in the prompt", () => {
    expect(prompt()).toContain("ไม่ใช่การขออนุมัติเป็นกรณีพิเศษ");
    expect(prompt()).toContain("ขอกู้ฉุกเฉินได้ไหมครับ");
  });

  it("is answered from the reference data and handed to สินเชื่อ", () => {
    expect(prompt()).toContain('request_staff_help ทันที (department: "สินเชื่อ")');
  });

  it("is never answered with the menu of what the bot can do", () => {
    // The member asked one thing and was shown a service list instead.
    expect(prompt()).toContain("ห้ามตอบด้วยการไล่รายการสิ่งที่บอทช่วยได้แทนคำตอบเด็ดขาด");
  });

  it("says the same thing where the model reads the tool itself", () => {
    expect(description()).toContain("is NOT an approval request either");
  });
});

describe("what the bot may ask a member", () => {
  // The note the bot is given while a member's document is waiting to be
  // handed to staff — which is where all three of these went wrong.
  const serviceNote = () =>
    buildSystemPrompt(
      null,
      null,
      { documentType: "สลิปเงินเดือน", requestType: null, department: null, imageUrl: null, imageIsPdf: false },
      null,
      "",
      ""
    ).dynamic;

  it("never asks why they need the money", () => {
    // The bot asked a member why he wanted an emergency loan, and offered
    // invented examples of acceptable reasons. Staff never needed either.
    expect(serviceNote()).toContain("ห้ามถามว่าจะเอาเงินไปทำอะไร");
  });

  it("never invents a loan type or a form that does not exist", () => {
    expect(serviceNote()).toContain("ห้ามยกตัวอย่างประเภทเงินกู้ ชื่อโครงการ หรือชื่อแบบฟอร์ม");
  });

  it("never explains its own classification to the member", () => {
    // "เอกสารนี้ไม่ใช่สลิปโอนเงิน" is the bot talking about its own rules.
    expect(prompt()).toContain("ห้ามอธิบายการจัดประเภทของระบบให้สมาชิกฟัง");
  });
});
