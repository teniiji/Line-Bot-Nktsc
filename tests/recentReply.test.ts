import { describe, expect, it } from "vitest";
import {
  RECENT_REPLY_WINDOW_MS,
  quoteReply,
  recentReplyNote,
} from "../lib/recentReply";

const NOW = new Date("2026-09-09T05:00:00Z");
const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000);

// Verbatim from the conversation this exists for: two replies posted in the
// same minute, because a slip and "จ่ายหนี้นะคะ" arrived a second apart and
// were answered as two unrelated messages.
const FIRST_REPLY =
  "รับสลิปโอนเงิน 30,000 บาท เรียบร้อยค่ะ แต่ก่อนบันทึกรายการ ดิฉันขอทราบชื่อ-นามสกุล และเลขสมาชิกของสมาชิกด้วยนะคะ";

describe("recentReplyNote", () => {
  it("hands back what the bot just said", () => {
    const note = recentReplyNote({ text: FIRST_REPLY, at: secondsAgo(2) }, NOW);
    expect(note).toContain(FIRST_REPLY);
  });

  it("forbids repeating it, and says what to do instead", () => {
    // "Do not repeat" alone would be wrong: a member who asks again needs the
    // answer again. What made the conversation read as unlistening was
    // repeating it in the same words — an eleven-item list pasted twice, the
    // second time in answer to "ใช่ไหมคะ".
    const note = recentReplyNote({ text: FIRST_REPLY, at: secondsAgo(2) }, NOW);
    expect(note).toContain("ห้ามพูดซ้ำ");
    expect(note).toContain("ห้ามทวนรายการหรือตัวเลือกชุดเดิมซ้ำ");
    expect(note).toContain("สั้นลงและง่ายขึ้นด้วยคำพูดที่ต่างออกไป");
  });

  it("says nothing once the member has had time to move on", () => {
    // Most messages carry no note at all — this only targets messages typed
    // in the same breath.
    const inside = new Date(NOW.getTime() - RECENT_REPLY_WINDOW_MS + 1000);
    const outside = new Date(NOW.getTime() - RECENT_REPLY_WINDOW_MS - 1000);
    expect(recentReplyNote({ text: FIRST_REPLY, at: inside }, NOW)).not.toBe("");
    expect(recentReplyNote({ text: FIRST_REPLY, at: outside }, NOW)).toBe("");
  });

  it("says nothing when there is no previous reply, or it was empty", () => {
    expect(recentReplyNote(null, NOW)).toBe("");
    expect(recentReplyNote({ text: "", at: secondsAgo(1) }, NOW)).toBe("");
    expect(recentReplyNote({ text: "   ", at: secondsAgo(1) }, NOW)).toBe("");
  });

  it("ignores a reply timestamped in the future", () => {
    // Clock skew between the app and the database, not a reply from ahead.
    expect(
      recentReplyNote({ text: FIRST_REPLY, at: new Date(NOW.getTime() + 5000) }, NOW)
    ).toBe("");
  });

  it("starts on its own paragraph, so it cannot run into the flow note", () => {
    expect(recentReplyNote({ text: FIRST_REPLY, at: NOW }, NOW).startsWith("\n\n")).toBe(true);
  });
});

describe("quoteReply", () => {
  it("leaves an ordinary reply alone", () => {
    expect(quoteReply(FIRST_REPLY)).toBe(FIRST_REPLY);
    expect(quoteReply(`  ${FIRST_REPLY}  `)).toBe(FIRST_REPLY);
  });

  it("caps a long reply and marks that it was cut", () => {
    // Bounded because this is both stored on every reply and sent on every
    // message inside the window; the shape is what the model needs, not the
    // whole text.
    const long = "ก".repeat(1000);
    const quoted = quoteReply(long);
    expect(quoted.length).toBeLessThan(long.length);
    expect(quoted.endsWith("…")).toBe(true);
  });
});

describe("how long the bot remembers what it said", () => {
  it("still remembers a question asked two minutes ago", () => {
    // The window was ninety seconds. A member asked for her name and member
    // number took a minute and a bit to answer, and the bot sent her the
    // identical question again, word for word. Pinned as a duration rather
    // than through the constant, because the constant is the thing that was
    // wrong.
    const note = recentReplyNote(
      { text: "ขอทราบชื่อ-นามสกุล และเลขสมาชิกของสมาชิกด้วยค่ะ", at: new Date(Date.now() - 2 * 60 * 1000) },
      new Date()
    );
    expect(note).toContain("ขอทราบชื่อ-นามสกุล");
  });

  it("has forgotten it an hour later", () => {
    const note = recentReplyNote(
      { text: "ขอทราบชื่อ-นามสกุล และเลขสมาชิกของสมาชิกด้วยค่ะ", at: new Date(Date.now() - 60 * 60 * 1000) },
      new Date()
    );
    expect(note).toBe("");
  });
});
