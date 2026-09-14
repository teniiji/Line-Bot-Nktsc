import { describe, expect, it } from "vitest";
import { closingNote, isAcknowledgementOnly } from "../lib/closingReply";

describe("isAcknowledgementOnly", () => {
  it("recognises the message this exists for", () => {
    // Verbatim from the conversation that prompted it: the member wrote this
    // and was answered with a greeting, a self-introduction, a list of
    // services and "มีเรื่องอะไรที่ต้องการช่วยวันนี้ไหมคะ".
    expect(isAcknowledgementOnly("ขอบคุณค่ะ")).toBe(true);
  });

  it("sees through particles, emoji and punctuation", () => {
    for (const text of [
      "ขอบคุณครับ",
      "ขอบคุณมากๆ นะคะ",
      "ขอบคุณค่ะ 🙏🙏",
      "ขอบคุณค่ะ!!!",
      "ขอบพระคุณมากค่ะ",
      "ขอบใจจ้า",
      "โอเคค่ะ",
      "รับทราบครับ",
      "เรียบร้อยค่ะ",
      "ทราบแล้วค่ะ",
      "ok thanks",
      "Thank you",
    ]) {
      expect(isAcknowledgementOnly(text), text).toBe(true);
    }
  });

  it("leaves a question alone even when it opens with thanks", () => {
    // The important half. Thai politeness opens a lot of questions with
    // "ขอบคุณค่ะ"; closing on one of those would drop the question entirely,
    // which is a worse failure than the greeting this fixes.
    for (const text of [
      "ขอบคุณค่ะ แล้วดอกเบี้ยเงินฝากเท่าไหร่คะ",
      "ขอบคุณค่ะ ขอถามอีกเรื่องนะคะ",
      "ขอบคุณครับ ผมโอนไปแล้ว 5000 บาท",
      "ไม่เข้าใจค่ะ",
      "โอนเงินค่าหุ้น 2000 ค่ะ",
      "สวัสดีค่ะ",
    ]) {
      expect(isAcknowledgementOnly(text), text).toBe(false);
    }
  });

  it("is not fooled by a long message that merely starts politely", () => {
    // The length guard: whatever words a paragraph begins with, a paragraph
    // is not a sign-off.
    const long =
      "ขอบคุณค่ะ พอดีว่าเดือนที่แล้วหักเงินเดือนไม่ได้ อยากทราบว่าต้องโอนเข้าบัญชีไหนคะ";
    expect(isAcknowledgementOnly(long)).toBe(false);
  });

  it("needs an actual acknowledgement, not just politeness", () => {
    // A bare "ค่ะ" is as often someone still typing as it is a sign-off, and
    // closing the conversation on it would cut them off.
    expect(isAcknowledgementOnly("ค่ะ")).toBe(false);
    expect(isAcknowledgementOnly("นะคะ")).toBe(false);
    expect(isAcknowledgementOnly("")).toBe(false);
    expect(isAcknowledgementOnly("   ")).toBe(false);
    expect(isAcknowledgementOnly("🙏")).toBe(false);
  });
});

describe("closingNote", () => {
  it("says nothing at all when the message is not an acknowledgement", () => {
    // Appended unconditionally by the caller, so silence has to be the
    // default — an ordinary message must reach the model unchanged.
    expect(closingNote(false, null)).toBe("");
    expect(closingNote(false, { kind: "transaction", category: "ซื้อหุ้น", amount: 500 })).toBe("");
  });

  it("forbids each thing the bot actually did wrong", () => {
    const note = closingNote(true, null);
    expect(note).toContain("สวัสดีค่ะ"); // named as the greeting to avoid
    expect(note).toContain("ห้ามทักทายใหม่");
    expect(note).toContain("ห้ามแนะนำตัว");
    expect(note).toContain("ห้ามถามว่ามีอะไรให้ช่วยอีกไหม");
    expect(note).toContain("ห้ามเรียก tool");
  });

  it("names what was just done, so the close can land on it", () => {
    const note = closingNote(true, {
      kind: "transaction",
      category: "ชำระหนี้",
      amount: 5000,
    });
    expect(note).toContain("ชำระหนี้");
    expect(note).toContain("5,000");
  });

  it("names a forwarded request the same way", () => {
    const note = closingNote(true, {
      kind: "serviceRequest",
      documentType: "สลิปเงินเดือน",
      requestType: "ขอกู้เงินสามัญ",
    });
    expect(note).toContain("สลิปเงินเดือน");
    expect(note).toContain("ขอกู้เงินสามัญ");
    expect(note).toContain("ส่งต่อให้เจ้าหน้าที่");
  });

  it("tells the bot not to guess when nothing recent is known", () => {
    // Without this the model fills the gap itself, and a confident "ยินดีค่ะ
    // ที่ได้ช่วยเรื่องการชำระหนี้" about a transaction that never happened is
    // worse than a plain thank-you.
    const note = closingNote(true, null);
    expect(note).toContain("ไม่มีข้อมูล");
    expect(note).toContain("ไม่เดา");
  });

  it("starts on its own paragraph, so it cannot run into the note above it", () => {
    expect(closingNote(true, null).startsWith("\n\n")).toBe(true);
  });

  it("handles a transaction whose amount was never captured", () => {
    const note = closingNote(true, { kind: "transaction", category: "ฝากเงิน", amount: null });
    expect(note).toContain("ฝากเงิน");
    expect(note).not.toContain("null");
    expect(note).not.toContain("NaN");
  });
});

// The conversation that made the rest of this file stricter, on 14 Sep. A
// member asked about an emergency loan, sent his salary document, and was
// asked what he wanted three times over. A staff member then answered him in
// the same chat — typed his name and member number for him, and told him what
// he could borrow. He said "ขอบคุณครับ", and the bot asked for his name and
// member number a fourth time.
describe("a thank-you while something is still pending", () => {
  it("forbids asking again for what the flow is missing", () => {
    const note = closingNote(true, null, true);
    expect(note).toContain("ห้ามถามสิ่งที่ขาดซ้ำในข้อความนี้เด็ดขาด");
  });

  it("says why: somebody answered them, and it was probably staff", () => {
    // Staff replies are typed in chat.line.biz and never reach this bot, so
    // "the member went quiet" and "the member was helped" look identical here.
    expect(closingNote(true, null, true)).toContain("เจ้าหน้าที่เป็นคนตอบเองในแชทนี้");
  });

  it("says the unfinished request is not lost by staying quiet", () => {
    expect(closingNote(true, null, true)).toContain("เห็นรายการค้างนั้นในระบบอยู่แล้ว");
  });

  it("leaves the note alone when nothing is pending", () => {
    const note = closingNote(true, null, false);
    expect(note).not.toContain("ห้ามถามสิ่งที่ขาดซ้ำ");
    expect(note).toContain("ข้อความนี้เป็นคำขอบคุณ");
  });

  it("still says nothing at all when the message was not a sign-off", () => {
    expect(closingNote(false, null, true)).toBe("");
  });

  it("asks for Thai a person would actually say", () => {
    // "ไม่ประเด็นค่ะ" reached a member. It is "no problem" translated word for
    // word, and it is not a phrase in this language.
    const note = closingNote(true, null, false);
    expect(note).toContain("ยินดีค่ะ");
    expect(note).toContain("ไม่ประเด็นค่ะ");
    expect(note).toContain("ห้ามแปลสำนวนภาษาอื่นมาตรงๆ");
  });
});
