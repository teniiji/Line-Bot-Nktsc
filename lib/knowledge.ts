import { prisma } from "./prisma";

// The cooperative reference block of the agent's system prompt (interest
// rates, welfare, contact info) lives in the KnowledgeEntry table so staff
// can update it from the dashboard without a code change + redeploy. These
// defaults mirror the migration's seed rows and are the fallback whenever
// the table is empty or unreadable — the bot must keep answering even if
// the knowledge table is somehow unavailable.
export const DEFAULT_KNOWLEDGE: { key: string; title: string; content: string; sortOrder: number }[] = [
  {
    key: "deposit_rates",
    title: "อัตราดอกเบี้ยเงินฝาก (ต่อปี)",
    content:
      "ออมทรัพย์ / ออมทรัพย์ ATM 1.25% | ออมทรัพย์พิเศษ 3.00% | ประจำ 6 เดือน 2.75% | ประจำ 12 เดือน 3.50% (ข้อมูล ณ สิ้นปี 2568)",
    sortOrder: 1,
  },
  {
    key: "loan_rates",
    title: "อัตราดอกเบี้ยเงินกู้ (ต่อปี)",
    content:
      "ทั่วไป (เงินกู้สามัญ, เพื่อการดำรงชีพ, เพื่อการโอนหนี้, ปรับโครงสร้างหนี้) 5.25% | โครงการพิเศษดอกเบี้ยต่ำ (72 งวด) 4.50% (ข้อมูล ณ สิ้นปี 2568)",
    sortOrder: 2,
  },
  {
    key: "welfare",
    title: "สวัสดิการสมาชิก",
    content:
      "ทุนการศึกษาบุตรสมาชิกจ่ายเป็นประจำทุกปี, การสงเคราะห์ผ่านสมาคมฌาปนกิจสงเคราะห์สมาชิกสหกรณ์ (ส.ส.ค.), เงินปันผลและเฉลี่ยคืนตามหุ้น/ธุรกิจ",
    sortOrder: 3,
  },
  {
    key: "contact",
    title: "ข้อมูลติดต่อ",
    // No email address here, on purpose.
    //
    // The cooperative's real address genuinely has "nktsc.org" as its local
    // part — nothing to do with the old nktsc.org website, which expired and
    // is now squatted with gambling content. LINE's client reads that
    // substring as a link-preview target with no scheme in front of it and
    // renders the squatter's card inline.
    //
    // This entry used to carry the address with a U+2060 WORD JOINER inside
    // it, and a note saying live testing had confirmed that breaks the match.
    // It does not. The advert appeared again on 11 Sep, under a conversation
    // in which a member had just sent her national ID number, with the same
    // joiner inserted into the finished reply by lib/replyText.ts — where
    // nothing can retype it away. It reached LINE intact and LINE unfurled
    // the domain regardless.
    //
    // There is no way to write the address that a matcher looking for domains
    // will not find, because it is a domain. sanitiseReplyText now removes
    // any address that reaches it; this entry does not offer the model one to
    // reach for in the first place. Members are given the telephone numbers,
    // which is what staff answer anyway.
    content:
      "ที่อยู่ 143 ถนนประจักษ์ ตำบลในเมือง อำเภอเมือง จังหวัดหนองคาย 43000 | โทรศัพท์บริหารสำนักงาน 042-411334, 042-423355, 042420746 | หุ้น-หนี้ 042-420495 | สมาคมฌาปนกิจ (สสค.) 042-413276, 064-8766432 | ติดต่อทางโทรศัพท์เท่านั้น (ระบบไม่แสดงอีเมลในแชท)",
    sortOrder: 4,
  },
  {
    key: "mai_dai_payment",
    title: "ช่องทางชำระยอดหักไม่ได้",
    content:
      "โอนเข้าบัญชีสหกรณ์ได้โดยตรง — กรุงไทย หนองคาย 413-1-00127-6 / บึงกาฬ 447-0-32262-8 — ภายในวันที่ 31 ของเดือน ไม่เกิน 15.00 น.",
    sortOrder: 5,
  },
  {
    key: "loan_eligibility",
    title: "เกณฑ์พิจารณาสิทธิ์กู้เงิน",
    content:
      "วงเงิน/สิทธิ์กู้ทุกประเภทขึ้นอยู่กับเงินเดือนคงเหลือของผู้กู้เป็นหลัก | กู้ดำรงชีพ ใช้สลิปเงินเดือนย้อนหลัง 3 เดือนประกอบพิจารณา | กู้ปิดกรุงไทย พิจารณาจากเงินเดือนคงเหลือ + ยอดหนี้กรุงไทยคงเหลือ (ตัวเลขวงเงินอนุมัติจริงต้องให้เจ้าหน้าที่ตรวจสอบในระบบเสมอ)",
    sortOrder: 6,
  },
];

function formatKnowledge(entries: { title: string; content: string }[]): string {
  return entries.map((e) => `- ${e.title}: ${e.content}`).join("\n");
}

// Serverless instances are short-lived, but one instance can still serve
// many webhook calls in a row — cache the assembled text briefly so the
// knowledge table isn't queried on every single message. 60s means a
// dashboard edit reaches the bot within a minute. Note that an edit also
// changes the cached system-prompt prefix, so the first message after an
// edit pays a fresh prompt-cache write — expected and rare.
let cached: { text: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

export async function getKnowledgeText(): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.text;
  }
  let text: string;
  try {
    const entries = await prisma.knowledgeEntry.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { title: true, content: true },
    });
    text = formatKnowledge(entries.length > 0 ? entries : DEFAULT_KNOWLEDGE);
  } catch (err) {
    console.error("[knowledge] read error, using built-in defaults:", err);
    text = formatKnowledge(DEFAULT_KNOWLEDGE);
  }
  cached = { text, fetchedAt: Date.now() };
  return text;
}
