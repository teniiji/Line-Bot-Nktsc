// A member who writes only "ขอบคุณค่ะ" is closing the conversation, not
// opening one. The bot has no conversation history (see the ข้อจำกัดสำคัญ
// paragraph in lib/agent/prompts.ts), so that message arrives looking exactly
// like a first contact — and the bot answers it as one: greets, introduces
// itself, lists what it can do, and asks what the member needs today, right
// after the member said they were done.
//
// Two things fix that. This module recognises the message for what it is, and
// builds the note that tells the model what was just done for this member, so
// the reply can close on the thing they are thanking the bot for instead of on
// a guess.

import { formatAmount } from "./format";

// The last thing the bot actually did for this member, when it was recent
// enough to be what they mean. Deliberately narrow: enough to name the
// subject in one clause, never enough to re-report the whole transaction.
export type RecentAction =
  | { kind: "transaction"; category: string; amount: number | null }
  | { kind: "serviceRequest"; documentType: string; requestType: string | null };

// Politeness particles and intensifiers, which carry no content of their own —
// stripped so "ขอบคุณมากๆ นะคะ" reduces to the same thing as "ขอบคุณ".
// Longest first: the loop below takes the first match, and "นะคะ" must not be
// eaten as "นะ" + a leftover "คะ" that some other pass has to clean up.
const PARTICLES = [
  "ครับผม",
  "นะครับ",
  "นะคะ",
  "ครับ",
  "มากๆ",
  "แหละ",
  "ค่ะ",
  "คะ",
  "ค่า",
  "คับ",
  "จ้า",
  "จ้ะ",
  "จ๊ะ",
  "ฮะ",
  "นะ",
  "น่ะ",
  "มาก",
  "เลย",
  "ด้วย",
  "แล้ว",
];

// Words that make a message an acknowledgement. A message must contain at
// least one of these — a bare "ค่ะ" is not enough, since it is as often the
// start of a sentence the member is still typing as it is a sign-off.
const ACKNOWLEDGEMENTS = [
  "ขอบพระคุณ",
  "ขอบคุณ",
  "ขอบใจ",
  "ขอบคุน",
  "รับทราบ",
  "เข้าใจ",
  "เรียบร้อย",
  "โอเค",
  "ทราบ",
  "thankyou",
  "thanks",
  "thank",
  "okay",
  "oke",
  "thx",
  "ok",
];

// Anything past this is a message with something in it, whatever words it
// happens to start with — a guard so a long paragraph that opens with
// "ขอบคุณค่ะ" and then asks something can never be treated as a sign-off.
const MAX_ACKNOWLEDGEMENT_LENGTH = 40;

// Strips punctuation, emoji and spaces, leaving only letters and digits, so
// "ขอบคุณค่ะ 🙏🙏" and "ขอบคุณ ค่ะ!!!" compare equal. \p{M} has to be kept
// alongside \p{L}: Thai vowel signs and tone marks are combining marks, not
// letters, so dropping them would reduce "ขอบคุณค่ะ" to "ขอบคณคะ" and none of
// the words below would ever match. ๆ survives on its own as a modifier
// letter, which is why "มากๆ" appears in PARTICLES with the mark attached.
function compact(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

/**
 * True when the message is nothing but thanks or acknowledgement — no
 * question, no new subject. "ขอบคุณค่ะ แล้วดอกเบี้ยเท่าไหร่" is false: the
 * thanks is only the polite opening of a question that still needs answering.
 */
export function isAcknowledgementOnly(text: string): boolean {
  let rest = compact(text);
  if (!rest || rest.length > MAX_ACKNOWLEDGEMENT_LENGTH) return false;

  // Peel acknowledgement words and particles off either end until nothing
  // peels. Both ends, because Thai puts the particle last ("ขอบคุณค่ะ") and
  // English puts it first ("ok thanks").
  let sawAcknowledgement = false;
  for (;;) {
    const ack = ACKNOWLEDGEMENTS.find((w) => rest.startsWith(w) || rest.endsWith(w));
    if (ack) {
      rest = rest.startsWith(ack) ? rest.slice(ack.length) : rest.slice(0, -ack.length);
      sawAcknowledgement = true;
      continue;
    }
    const particle = PARTICLES.find((w) => rest.startsWith(w) || rest.endsWith(w));
    if (!particle) break;
    rest = rest.startsWith(particle)
      ? rest.slice(particle.length)
      : rest.slice(0, -particle.length);
  }

  // Only when the whole message was made of those words. Anything left over
  // is content the member expects an answer to.
  return sawAcknowledgement && rest.length === 0;
}

function describeRecentAction(action: RecentAction): string {
  if (action.kind === "transaction") {
    const amount = action.amount === null ? "" : ` จำนวน ${formatAmount(action.amount)}`;
    return `บันทึกรายการ${action.category}${amount} ให้เรียบร้อยแล้ว`;
  }
  const purpose = action.requestType ? ` (เรื่อง ${action.requestType})` : "";
  return `รับเรื่อง${action.documentType}${purpose} และส่งต่อให้เจ้าหน้าที่แล้ว`;
}

// What the bot must not do here, spelled out rather than implied. Every one
// of these appeared in the reply this module exists to replace: it greeted,
// introduced itself, listed its services, and asked what the member needed
// today — in answer to "ขอบคุณค่ะ".
const CLOSING_RULES =
  "ให้ตอบสั้นๆ เพื่อปิดบทสนทนาให้จบ **ห้ามทักทายใหม่ (ห้ามขึ้นต้นว่า \"สวัสดีค่ะ\") " +
  "ห้ามแนะนำตัวหรือไล่รายการสิ่งที่ช่วยได้ ห้ามถามว่ามีอะไรให้ช่วยอีกไหม และห้ามเรียก tool ใดๆ**";

/**
 * The หมายเหตุระบบ appended to the dynamic half of the system prompt when the
 * member's message is only an acknowledgement. Empty string when it isn't, so
 * the caller can drop it in unconditionally.
 */
export function closingNote(
  isAcknowledgement: boolean,
  recent: RecentAction | null
): string {
  if (!isAcknowledgement) return "";
  const context = recent
    ? `เรื่องที่เพิ่งทำให้สมาชิกคนนี้ไปล่าสุดคือ: ${describeRecentAction(recent)} ` +
      "ให้อ้างถึงเรื่องนี้สั้นๆ เพียงประโยคเดียวเพื่อให้คำตอบจบตรงกับบริบทที่คุยกันอยู่ ห้ามรายงานรายละเอียดซ้ำทั้งหมด"
    : "ระบบไม่มีข้อมูลว่าเพิ่งทำเรื่องอะไรให้สมาชิกคนนี้ ให้ตอบรับคำขอบคุณอย่างสุภาพโดยไม่เดาว่าเป็นเรื่องอะไร";
  return (
    "\n\nหมายเหตุระบบ (สำคัญ): ข้อความนี้เป็นคำขอบคุณ/คำรับทราบล้วนๆ ไม่มีคำถามหรือเรื่องใหม่ " +
    `${CLOSING_RULES} ${context}`
  );
}
