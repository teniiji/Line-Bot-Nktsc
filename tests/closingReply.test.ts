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
