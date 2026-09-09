// One turn of memory: what the bot itself said last.
//
// Every message is processed on its own with no history (see the ข้อจำกัดสำคัญ
// paragraph in lib/agent/prompts.ts), and the bot cannot see its own replies
// either. Two messages sent a second apart — a slip, then "จ่ายหนี้นะคะ" —
// are two separate runs, and the member gets two answers that say the same
// thing:
//
//   "รับสลิปโอนเงิน 30,000 บาท เรียบร้อยค่ะ แต่ก่อนบันทึกรายการ ดิฉันขอทราบ
//    ชื่อ-นามสกุล และเลขสมาชิกของสมาชิกด้วยนะคะ"
//   "…ดิฉันจะช่วยบันทึกรายการจ่ายหนี้ของสมาชิก แต่ต้องได้รับ: 1. ชื่อ-นามสกุล
//    2. เลขสมาชิก 3. สลิปการโอนเงิน 4. ประเภทเงินกู้…"
//
// The same conversation later pasted an eleven-item list of categories twice
// in a row, the second time in answer to the member asking "ใช่ไหมคะ".
//
// So the last reply is handed back, and the instruction is not "do not
// repeat" but "do not repeat it the same way": a member who asks again needs
// the answer again, shorter and in different words. Repeating it verbatim is
// what reads as not having been listened to.

// Only a reply the member is plausibly still looking at. Long enough to cover
// two messages typed in the same breath, short enough that an ordinary
// conversational gap costs nothing — most messages carry no note at all.
export const RECENT_REPLY_WINDOW_MS = 90 * 1000;

// Enough of the reply for the model to recognise what it said. The full text
// would crowd the flow note it sits beside, and only the shape matters.
const QUOTE_LIMIT = 400;

export interface PreviousReply {
  text: string;
  at: Date;
}

export function quoteReply(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > QUOTE_LIMIT ? `${trimmed.slice(0, QUOTE_LIMIT)}…` : trimmed;
}

/**
 * The หมายเหตุระบบ telling the model what it just said, or "" when there is
 * nothing recent enough to matter — so the caller can append it
 * unconditionally.
 */
export function recentReplyNote(previous: PreviousReply | null, now: Date): string {
  if (!previous) return "";
  const trimmed = previous.text.trim();
  if (!trimmed) return "";

  const age = now.getTime() - previous.at.getTime();
  // A negative age is clock skew between the app and the database, not a
  // reply from the future.
  if (age < 0 || age > RECENT_REPLY_WINDOW_MS) return "";

  return (
    "\n\nหมายเหตุระบบ (สำคัญ): คุณเพิ่งตอบสมาชิกคนนี้ไปเมื่อไม่กี่วินาทีที่แล้วว่า:\n" +
    `«${quoteReply(trimmed)}»\n` +
    "สมาชิกยังอ่านข้อความนั้นอยู่ **ห้ามพูดซ้ำเนื้อความเดิม ห้ามทวนรายการหรือตัวเลือกชุดเดิมซ้ำอีกรอบ " +
    "และห้ามถามซ้ำสิ่งที่เพิ่งถามไปด้วยถ้อยคำเดิม** ให้ตอบต่อยอดจากข้อความนั้น " +
    "ถ้าสมาชิกดูเหมือนไม่เข้าใจหรือถามย้ำ ให้อธิบายใหม่ให้สั้นลงและง่ายขึ้นด้วยคำพูดที่ต่างออกไป ไม่ใช่วางข้อความเดิมซ้ำ"
  );
}
