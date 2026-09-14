// The message a member tapped "ตอบกลับ" on.
//
// LINE puts a quotedMessageId on a text message that quotes an earlier one,
// and nothing here ever read it. The bot has no conversation history (see the
// ข้อจำกัดสำคัญ paragraph in lib/agent/prompts.ts), so a member who quotes the
// bot's own question and answers it in three words — "อันนี้ค่ะ", "ใช่ค่ะ
// อันแรก" — hands the model a message with the context deliberately attached
// and the model reads the three words alone. On the screen the member is
// looking at, the quoted line is right there above what they typed.
//
// That is the one case of "ไม่รู้ว่าสมาชิกพูดถึงอะไร" — the third reason the
// bot is allowed to stay silent and leave the message to staff — that is not
// really unknowable. The member said what they were talking about; the bot
// simply was not shown it.
//
// So every text message in the conversation is kept for a fortnight under its
// LINE message id, the bot's own replies included (the reply API hands back
// the ids of what it just sent), and when one of them is quoted the text is
// put in front of the model. Kept short (see QUOTED_TEXT_LIMIT) and pruned on
// a fortnight's clock: this is a rolling window for reading a quote back, not
// a chat archive.
//
// Not everything is resolvable. Staff answering in chat.line.biz send
// messages this application never sees, so their ids are never stored, and a
// member quoting a staff reply lands on nothing. That case is worth a note of
// its own — a message that reads like a fragment is explained by the quote
// the model cannot see, and knowing a quote was there is better than being
// left to wonder why the sentence has no subject.

// Enough of the quoted message to know what it was about. The same limit the
// bot's own last reply is kept at (lib/recentReply.ts) and for the same
// reason: only the shape matters, and a long quote would crowd the flow note
// it sits beside.
export const QUOTED_TEXT_LIMIT = 400;

// How long a message stays quotable. A quote reaching further back than this
// is rare enough to fall through to the unresolved note, and keeping the
// conversation's text beyond a fortnight buys nothing: this table exists to
// read one line back into the next message, not to keep a record of what
// members said.
export const QUOTED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface QuotedMessage {
  text: string;
  fromBot: boolean;
}

/** What gets stored, and what gets quoted back — trimmed and capped. */
export function quotableText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > QUOTED_TEXT_LIMIT
    ? `${trimmed.slice(0, QUOTED_TEXT_LIMIT)}…`
    : trimmed;
}

/**
 * The หมายเหตุระบบ naming what the member is replying to, or "" when this
 * message quotes nothing — so the caller can append it unconditionally.
 *
 * `quoted` is null when the message quotes something the system has no copy
 * of; `quoting` says whether there was a quote at all.
 */
export function quotedMessageNote(quoting: boolean, quoted: QuotedMessage | null): string {
  if (!quoting) return "";

  if (!quoted) {
    return (
      "\n\nหมายเหตุระบบ (สำคัญ): ข้อความนี้สมาชิกกด “ตอบกลับ” อ้างถึงข้อความก่อนหน้าในแชท " +
      "แต่ระบบไม่มีเนื้อความของข้อความนั้นเก็บไว้ (อาจเป็นข้อความที่เจ้าหน้าที่พิมพ์เอง หรือเก่าเกินไป) " +
      "ดังนั้นข้อความที่เห็นอาจสั้นหรือดูไม่มีต้นเรื่อง เพราะต้นเรื่องอยู่ในข้อความที่ถูกอ้างถึง " +
      "ถ้าพอเดาเรื่องได้จากหมายเหตุอื่นด้านบน ให้ตอบต่อจากเรื่องนั้น " +
      "ถ้าเดาไม่ได้จริงๆ ให้ถามสั้นๆ เพียงประโยคเดียวว่าสมาชิกต้องการให้ช่วยเรื่องใด " +
      "**ห้ามอธิบายว่าระบบอ่านข้อความที่อ้างถึงไม่ได้ และห้ามขอให้สมาชิกพิมพ์ใหม่ทั้งหมด**"
    );
  }

  const whose = quoted.fromBot
    ? "ข้อความที่ตัวคุณเอง (บอท) เคยส่งไปให้สมาชิกว่า"
    : "ข้อความที่ตัวสมาชิกเองเคยส่งเข้ามาก่อนหน้านี้ว่า";

  return (
    `\n\nหมายเหตุระบบ (สำคัญ): ข้อความนี้สมาชิกกด “ตอบกลับ” อ้างถึง${whose}:\n` +
    `«${quotableText(quoted.text)}»\n` +
    "นี่คือเรื่องที่สมาชิกกำลังพูดถึง ให้ตอบต่อจากเรื่องนั้นโดยตรง " +
    "**ห้ามถามว่าหมายถึงเรื่องอะไร ห้ามถือว่าไม่รู้ว่าสมาชิกพูดถึงอะไร และห้ามเงียบด้วยเหตุผลนั้น** " +
    "ถ้าข้อความที่สมาชิกพิมพ์มาสั้นมาก (เช่น “ใช่ค่ะ” “อันนี้” “แล้วแบบนี้ล่ะ”) ให้ตีความว่าเป็นคำตอบของเรื่องในข้อความที่อ้างถึง"
  );
}
