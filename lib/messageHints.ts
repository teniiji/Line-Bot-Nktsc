// What a member's message already told us, found deterministically, so the
// bot stops asking for things it has just been handed.
//
// From a real conversation. The bot had the slip and asked for a name and a
// member number. The member answered:
//
//   "ฝากออมทรัพย์พิเศษบัญชีนางพิศวง พรหมจรรย์ จำนวน 200,000บาทค่ะ"
//
// which carries the name and the category, and the bot took neither — it
// repeated its previous message word for word. She was asked for her name
// again two messages later and typed it a second time. Three rounds for a
// conversation that had everything it needed after one.
//
// The name was missed because it is glued mid-sentence to the word before it
// ("บัญชีนางพิศวง") and reads as part of a phrase about an account rather
// than as an answer to a question. Thai writes no spaces between words, so
// there is nothing to make it stand out — except the title, which a member
// giving their own name almost always writes.
//
// So these are found by rule and handed to the model as a note, not applied
// behind its back: it can see the whole message and decides. A rule that is
// unsure says nothing, which is the same standard lib/thaiBanks.ts holds —
// a hint is worth having only if it can be trusted.

import { CATEGORIES, type Category } from "./categories";

// Thai letters excluding ๆ (the repetition mark, never inside a name) and the
// Thai digits.
const THAI = "[\\u0E01-\\u0E45\\u0E47-\\u0E4E]";

// The titles a member writes in front of their own name. Longest first: the
// alternation is ordered, so "นางสาว" must be offered before "นาง" or every
// นางสาว would be read as a นาง whose given name starts with "สาว".
const TITLES = ["นางสาว", "น\\.ส\\.", "นส\\.", "นาย", "นาง", "ดร\\.", "ด\\.ช\\.", "ด\\.ญ\\."];

const NAME_PATTERN = new RegExp(
  `(${TITLES.join("|")})\\s?(${THAI}{2,20})\\s+(${THAI}{2,20})`,
  "g"
);

// Ordinary words that begin with a title and are not names. "นายทะเบียน" is
// the one that matters here — a cooperative talks about its registrar — but
// the rest cost nothing to exclude.
const NOT_NAMES = new Set([
  "นายทะเบียน",
  "นายจ้าง",
  "นายหน้า",
  "นายก",
  "นายแพทย์",
  "นายช่าง",
  "นายประกัน",
  "นายเรือ",
  "นายพราน",
  "นายท้าย",
  "นายอำเภอ",
  "นายตรวจ",
  "นางฟ้า",
  "นางแบบ",
  "นางเอก",
  "นางพยาบาล",
  "นางสาวไทย",
]);

/**
 * A titled Thai name in the text, written as the roster writes one, or null.
 *
 * Deliberately not anchored to the start of the message or to a word
 * boundary: Thai has neither, and the case this exists for is a name in the
 * middle of a sentence about something else.
 */
export function findThaiName(text: string): string | null {
  for (const match of text.matchAll(NAME_PATTERN)) {
    const [, title, given, family] = match;
    if (NOT_NAMES.has(`${title}${given}`)) continue;
    return `${title}${given} ${family}`;
  }
  return null;
}

// What a member calls each category when they are not picking from a list.
// Every phrase here has to be one that means this category and nothing else:
// "ฝาก" on its own is in half the polite sentences in Thai ("ฝากดูให้หน่อย")
// and is deliberately absent.
const CATEGORY_PHRASES: Record<Category, string[]> = {
  ซื้อหุ้น: ["ซื้อหุ้น", "ค่าหุ้น", "เพิ่มหุ้น", "ส่งหุ้น"],
  ชำระหนี้: ["ชำระหนี้", "จ่ายหนี้", "ส่งหนี้", "ชำระเงินกู้", "จ่ายเงินกู้", "ผ่อนชำระ", "ชำระค่างวด"],
  ฝากเงิน: ["ฝากเงิน", "ฝากออมทรัพย์", "ออมทรัพย์พิเศษ", "ฝากประจำ", "ฝากสัจจะ", "เงินฝาก"],
  ชำระเก็บไม่ได้รายเดือน: ["เก็บไม่ได้", "หักไม่ได้", "หักไม่ผ่าน"],
  ชำระประกัน: ["ชำระประกัน", "จ่ายประกัน", "ค่าประกัน", "เบี้ยประกัน", "ประกันชีวิต"],
  ชำระฌาปนกิจ: ["ฌาปนกิจ", "ฌาปนกิจสงเคราะห์"],
  สสค: ["สสค"],
  สสอค: ["สสอค"],
  สสชสอ: ["สสชสอ"],
  สสสก: ["สสสก"],
  สสสท: ["สสสท"],
};

// Members write these with and without the dots — "สส.อค" and "สสอค" are the
// same association — so both sides of the comparison lose them.
const undotted = (text: string) => text.replace(/[.\s]/g, "");

/**
 * The category the message names, or null when it names none — or more than
 * one, which is the same thing as far as a hint is concerned. A message that
 * could be two categories is exactly the one a person should be asked about.
 */
export function findCategory(text: string): Category | null {
  const haystack = undotted(text);
  const found = CATEGORIES.filter((category) =>
    CATEGORY_PHRASES[category].some((phrase) => haystack.includes(undotted(phrase)))
  );
  return found.length === 1 ? found[0] : null;
}

export interface HintContext {
  // Null when the message carried no text of its own — an image on its own
  // tells us nothing to read.
  text: string | null;
  // What is actually still outstanding. A hint about something already on
  // record is noise, and worse: it invites the model to overwrite a name the
  // roster gave with one read out of a sentence.
  needsName: boolean;
  needsCategory: boolean;
}

/**
 * The หมายเหตุระบบ naming what this message already answered, or "" when it
 * answered nothing — so the caller can append it unconditionally.
 */
export function messageHintNote({ text, needsName, needsCategory }: HintContext): string {
  if (!text) return "";

  const name = needsName ? findThaiName(text) : null;
  const category = needsCategory ? findCategory(text) : null;
  if (!name && !category) return "";

  const parts: string[] = [];
  if (name) {
    parts.push(
      `**ชื่อ-นามสกุล: «${name}»** ให้เรียก submit_member_info ด้วยชื่อนี้ทันที ห้ามถามชื่อซ้ำ`
    );
  }
  if (category) {
    parts.push(`**หมวดหมู่: «${category}»** ให้ใช้หมวดหมู่นี้ ห้ามถามหมวดหมู่ซ้ำ`);
  }

  return (
    "\n\nหมายเหตุระบบ (สำคัญ): ข้อความล่าสุดของสมาชิกมีข้อมูลที่ระบบกำลังรออยู่แล้ว —\n" +
    parts.map((part) => `• ${part}`).join("\n") +
    "\nอ่านข้อความเต็มอีกครั้งก่อนตอบ ถ้าดูแล้วไม่ใช่ข้อมูลของสมาชิกจริงๆ ให้ข้ามข้อนั้นไปได้ " +
    "แต่ห้ามถามซ้ำสิ่งที่สมาชิกเพิ่งพิมพ์มาให้แล้ว"
  );
}
