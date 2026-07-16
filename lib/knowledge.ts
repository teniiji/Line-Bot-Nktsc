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
    content:
      "ที่อยู่ 143 ถนนประจักษ์ ตำบลในเมือง อำเภอเมือง จังหวัดหนองคาย 43000 | โทรศัพท์บริหารสำนักงาน 042-411334, 042-423355, 042420746 | หุ้น-หนี้ 042-420495 | สมาคมฌาปนกิจ (สสค.) 042-413276, 064-8766432 | อีเมล nktsc.org@gmail.com",
    sortOrder: 4,
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
