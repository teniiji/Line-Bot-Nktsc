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
    title: "อัตราดอกเบี้ยเงินกู้",
    content:
      "ทั่วไป (เงินกู้สามัญ, เพื่อการดำรงชีพ, ฉุกเฉิน, เพื่อการโอนหนี้, ปรับโครงสร้างหนี้) 5.25% ต่อปี | โครงการพิเศษดอกเบี้ยต่ำ (วงเงินไม่เกิน 500,000 บาท ผ่อน 72 งวด) 0.75% ต่อเดือน (อัตรา ณ ปัจจุบันตามประกาศคณะกรรมการ อาจเปลี่ยนแปลงได้ ควรยืนยันกับเจ้าหน้าที่หากไม่แน่ใจ)",
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
    // The cooperative's real email genuinely has "nktsc.org" as its local
    // part (nothing to do with the old nktsc.org website, which is now an
    // expired domain squatted with unrelated/gambling content) — but LINE's
    // client still recognized that substring as a link-preview target and
    // rendered the squatter's content inline, even with no "http(s)://"
    // scheme present (contradicts the "bare domains are left alone"
    // assumption in lib/links.ts, confirmed by live testing). A U+2060 WORD
    // JOINER between "nktsc" and ".org" breaks the pattern match while
    // staying invisible and non-copy-breaking, so the address still reads
    // and copy-pastes correctly.
    content:
      "ที่อยู่ 143 ถนนประจักษ์ ตำบลในเมือง อำเภอเมือง จังหวัดหนองคาย 43000 | โทรศัพท์บริหารสำนักงาน 042-411334, 042-423355, 042420746 | หุ้น-หนี้ 042-420495 | สมาคมฌาปนกิจ (สสค.) 042-413276, 064-8766432 | อีเมล nktsc⁠.org@gmail.com",
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
  {
    key: "loan_normal_limits",
    title: "วงเงินกู้สามัญ (ระเบียบ พ.ศ. 2569 บังคับใช้ 1 ก.พ. 2569)",
    content:
      "วงเงินสูงสุด 100 เท่าของเงินเดือน ต้องมีหุ้นไม่น้อยกว่า 20% ของวงเงินกู้ | อายุตัวไม่เกิน 55 ปี กู้ได้ไม่เกิน 2,000,000 บาท ผ่อนได้ 150 งวด | อายุ 56 ปี ไม่เกิน 2,000,000 บาท (ส่วนเกินหนี้เดิมกู้เพิ่มได้ไม่เกิน 1,000,000 บาท) | เพดานสูงสุดรวม 3,000,000 บาท ขึ้นกับอายุสมาชิก | จำนวนผู้ค้ำประกันตามวงเงิน: ไม่เกิน 300,000 บาท ใช้ผู้ค้ำ 1 คน, เกิน 300,000-800,000 บาท 2 คน, เกิน 800,000-900,000 บาท 3 คน, เกิน 900,000-1,150,000 บาท 4 คน, เกิน 1,150,000-2,000,000 บาท 5 คน, เกิน 2,000,000-3,000,000 บาท 6 คน | วงเงินไม่เกิน 90% ของหุ้นไม่ต้องมีผู้ค้ำ | ยื่นคำขอภายในวันที่ 5 ของทุกเดือน (ตัวเลขอนุมัติจริงต้องให้เจ้าหน้าที่ตรวจสอบเสมอ)",
    sortOrder: 7,
  },
  {
    key: "loan_subsistence",
    title: "เงินกู้เพื่อการดำรงชีพ (ATM)",
    content:
      "วงเงินไม่เกินครึ่งหนึ่งของเงินได้รายเดือน เพดานตามอายุตัว: ไม่เกิน 55 ปี 2,000,000 บาท / ไม่เกิน 56 ปี 1,500,000 บาท / 57 ปีขึ้นไป 1,000,000 บาท | ผ่อนได้สูงสุด 150 งวด | ไม่ต้องมีผู้ค้ำประกัน | เอกสาร: สลิปเงินเดือนย้อนหลัง 3 เดือน รับรองสำเนาโดยผู้บังคับบัญชา | ยื่นคำขอได้ทุกวันทำการก่อนเวลา 12.00 น. เอกสารครบอนุมัติและถอนได้วันถัดไป",
    sortOrder: 8,
  },
  {
    key: "loan_emergency",
    title: "เงินกู้เพื่อเหตุฉุกเฉิน",
    content:
      "กรณีปกติ: กู้ได้ไม่เกิน 15 เท่าของเงินเดือนส่วนที่เหลือหลังหักชำระหนี้ หรือไม่เกิน 90% ของหุ้น (เลือกวิธีที่ให้วงเงินมากกว่า) ผ่อนไม่เกิน 12 งวด ไม่ต้องมีผู้ค้ำประกัน | กรณีพิเศษ (สมัคร สสอค./สส.ชสอ./สส.สท./สส.สก./สส.อร./ประกันชีวิตสหกรณ์): ไม่เกินวงเงินค่าสมัคร ผ่อนไม่เกิน 12 งวด กู้พร้อมกรณีปกติในคราวเดียวกันได้ | ยื่นคำขอพร้อมเอกสารครบก่อนเวลา 12.00 น. ทุกวันทำการ รับเงินสดหรือโอนได้วันเดียวกัน",
    sortOrder: 9,
  },
  {
    key: "loan_low_interest_special",
    title: "เงินกู้สามัญพิเศษดอกเบี้ยต่ำ",
    content:
      "วงเงินกู้สูงสุด 500,000 บาท ดอกเบี้ย 0.75% ต่อเดือน ผ่อนชำระเงินต้น+ดอกเบี้ยเท่ากันทุกงวด 72 งวด | คุณสมบัติ: เป็นสมาชิกและทำงานมาแล้วไม่น้อยกว่า 3 เดือน ไม่เคยผิดนัดชำระหนี้กับสหกรณ์ | ผู้ค้ำประกัน: วงเงินไม่เกิน 200,000 บาท ใช้ผู้ค้ำ 1 คน / วงเงิน 200,000-500,000 บาท ใช้ผู้ค้ำ 2 คน | ผิดนัดชำระเกิน 3 งวด ปรับเป็นหนี้ผิดนัดทันที (ระเบียบบังคับใช้ตั้งแต่ 4 ธ.ค. 2567)",
    sortOrder: 10,
  },
  {
    key: "loan_debt_transfer",
    title: "เงินกู้พิเศษเพื่อการโอนหนี้จากสถาบันการเงินอื่น",
    content:
      "สำหรับสมาชิกที่มีหนี้กับธนาคาร/สถาบันการเงินอื่นที่ดอกเบี้ยสูงกว่าสหกรณ์ ให้กู้เพื่อนำไปปิดหนี้เดิม โอนภาระมาอยู่กับสหกรณ์แทน | เอกสารเพิ่มเติมเฉพาะประเภทนี้: รายการเคลื่อนไหวบัญชี (Statement) หรือหนังสือรับรองยอดหนี้จากสถาบันการเงินเดิม และเอกสารเครดิตบูโร (NCB)",
    sortOrder: 11,
  },
  {
    key: "loan_guarantor_heir_special",
    title: "เงินกู้สามัญพิเศษ ช่วยเหลือผู้ค้ำประกัน/ทายาท/ผู้รับสภาพหนี้",
    content:
      "สำหรับสมาชิกที่ต้องรับภาระหนี้แทนผู้กู้เดิมในฐานะผู้ค้ำประกัน/ทายาท/ผู้รับสภาพหนี้ (กรณีผู้กู้เดิมเสียชีวิต ถูกฟ้อง หรือผิดนัดชำระ) ให้กู้เงินก้อนใหม่มาผ่อนแทนหนี้ที่รับภาระมา แทนการแบกดอกเบี้ยผิดนัดอัตราสูง | แบบฟอร์มคำขอดาวน์โหลดได้ที่หน้าดาวน์โหลดเอกสารของเว็บไซต์สหกรณ์ | เป็นกรณีละเอียดอ่อนเกี่ยวข้องกับการเสียชีวิต/คดีความของผู้อื่นเสมอ ให้แนะนำติดต่อเจ้าหน้าที่สินเชื่อตรวจสอบเป็นรายกรณี ห้ามตอบเองว่าเข้าเกณฑ์หรือไม่",
    sortOrder: 12,
  },
  {
    key: "loan_documents_checklist",
    title: "เอกสารประกอบคำขอกู้สามัญ / ดำรงชีพ / ฉุกเฉิน",
    content:
      "ผู้กู้และคู่สมรส: สำเนาบัตรประชาชน, สำเนาทะเบียนบ้าน, ทะเบียนสมรส (กรณีหย่า/หม้ายแนบเอกสารเพิ่ม), สลิปเงินเดือนย้อนหลัง 3 เดือนรับรองสำเนาโดยผู้บังคับบัญชา, แบบสอบถามหนี้ธนาคารออมสิน | ผู้ค้ำประกัน: สำเนาบัตรประชาชน, สำเนาทะเบียนบ้าน (ไม่ต้องมีเอกสารคู่สมรสผู้ค้ำ) | เงินกู้ฉุกเฉินไม่ต้องมีผู้ค้ำประกัน ใช้เอกสารผู้กู้ชุดเดียวกัน | ใช้ปากกาสีน้ำเงินเท่านั้นในการลงนามเอกสารทุกฉบับ",
    sortOrder: 13,
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
