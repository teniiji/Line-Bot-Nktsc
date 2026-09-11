import { describe, expect, it } from "vitest";
import {
  QUOTED_TEXT_LIMIT,
  quotableText,
  quotedMessageNote,
} from "../lib/quotedMessage";
import { buildSystemPrompt } from "../lib/agent/prompts";

describe("quotableText", () => {
  it("keeps a short message as it is", () => {
    expect(quotableText("  ขอกู้เงินสามัญค่ะ  ")).toBe("ขอกู้เงินสามัญค่ะ");
  });

  it("caps a long one, so the quote cannot crowd out the flow note", () => {
    const long = "ก".repeat(QUOTED_TEXT_LIMIT + 50);
    const out = quotableText(long);
    expect(out).toHaveLength(QUOTED_TEXT_LIMIT + 1);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("quotedMessageNote", () => {
  it("says nothing at all when the message quotes nothing", () => {
    // Nearly every message. The caller appends this unconditionally.
    expect(quotedMessageNote(false, null)).toBe("");
    expect(quotedMessageNote(false, { text: "อะไรสักอย่าง", fromBot: true })).toBe("");
  });

  it("puts the bot's own quoted question back in front of the model", () => {
    // The case this exists for: the member taps ตอบกลับ on the question and
    // answers it in two words.
    const note = quotedMessageNote(true, {
      text: "สมาชิกต้องการทำรายการอะไรคะ",
      fromBot: true,
    });
    expect(note).toContain("สมาชิกต้องการทำรายการอะไรคะ");
    expect(note).toContain("บอท");
  });

  it("says whose message it was, so the model does not answer its own words", () => {
    const mine = quotedMessageNote(true, { text: "ขอกู้เงินค่ะ", fromBot: false });
    expect(mine).toContain("ตัวสมาชิกเอง");
    expect(mine).not.toContain("ตัวคุณเอง");
  });

  it("forbids the silence that was covering this case", () => {
    // leave_to_staff's third reason is "ไม่รู้ว่าสมาชิกพูดถึงอะไร". With the
    // quote read back, the bot does know.
    const note = quotedMessageNote(true, { text: "ยอดกู้สามัญเหลือเท่าไหร่", fromBot: false });
    expect(note).toContain("ห้ามถือว่าไม่รู้ว่าสมาชิกพูดถึงอะไร");
  });

  it("trims the quoted text the same way it was stored", () => {
    const note = quotedMessageNote(true, { text: `${"ข".repeat(600)}`, fromBot: true });
    expect(note).toContain("…");
    expect(note.length).toBeLessThan(1200);
  });

  it("explains the fragment when the quoted message cannot be found", () => {
    // Staff answering in chat.line.biz never come through this application,
    // so their message ids are never stored.
    const note = quotedMessageNote(true, null);
    expect(note).toContain("อ้างถึงข้อความก่อนหน้า");
    expect(note).toContain("ห้ามอธิบายว่าระบบอ่านข้อความที่อ้างถึงไม่ได้");
  });

  it("does not ask the member to type it all again", () => {
    // The member already wrote it once, and quoting it was the whole point.
    expect(quotedMessageNote(true, null)).toContain("ห้ามขอให้สมาชิกพิมพ์ใหม่ทั้งหมด");
  });
});

describe("where the note ends up in the prompt", () => {
  const build = (quotedNote: string) =>
    buildSystemPrompt(null, null, null, null, "", "", new Set(), 0, "", "", "", quotedNote);

  it("carries the quote in the per-message block, not the cached one", () => {
    // The base block is prompt-cached and identical on every call; a quote
    // belongs to one message only.
    const note = quotedMessageNote(true, { text: "ยอดหักเดือนนี้ 3,200 บาทค่ะ", fromBot: true });
    const { base, dynamic } = build(note);
    expect(dynamic).toContain("ยอดหักเดือนนี้ 3,200 บาทค่ะ");
    expect(base).not.toContain("ยอดหักเดือนนี้ 3,200 บาทค่ะ");
  });

  it("puts it last, next to the member's own message", () => {
    const { dynamic } = build("\n\nหมายเหตุระบบ (สำคัญ): QUOTE-MARKER");
    expect(dynamic.trimEnd().endsWith("QUOTE-MARKER")).toBe(true);
  });

  it("changes nothing on a message that quotes nothing", () => {
    expect(build("").dynamic).toBe(build(quotedMessageNote(false, null)).dynamic);
  });

  it("tells the model in the prompt that a quote answers 'ไม่รู้ว่าพูดถึงอะไร'", () => {
    // The third reason leave_to_staff allows silence for. The member said
    // what they meant; the bot simply had not been shown it until now.
    expect(build("").base).toContain("ห้ามใช้ข้อนี้เงียบเด็ดขาด");
  });
});
