import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { anthropic } from "./anthropicClient";
import { prisma } from "./prisma";
import { CATEGORIES } from "./categories";
import { LOAN_TYPES } from "./loanTypes";
import { formatAmount } from "./format";

// Haiku is fast/cheap and reliable for plain text, but has repeatedly
// misread slips with busy/themed backgrounds (inventing reasons to decline
// a perfectly legible transaction). Use a stronger model whenever the
// message includes an image.
const TEXT_MODEL = "claude-haiku-4-5";
const VISION_MODEL = "claude-sonnet-5";
const MAX_TOOL_TURNS = 3;

function hasImageContent(content: Anthropic.MessageParam["content"]): boolean {
  return (
    typeof content !== "string" &&
    content.some((block) => block.type === "image")
  );
}

const tools: Anthropic.Tool[] = [
  {
    name: "report_transaction",
    description:
      "Call this whenever the user describes or shows (via a slip image) a completed cooperative transaction: a share purchase (ซื้อหุ้น), a loan repayment (ชำระหนี้), a savings deposit (ฝากเงิน), or one of the other cooperative payment categories. Call it every time, even if you don't yet have every detail — the system tracks what's still missing (member identity, transfer slip, category, loan type) and tells you exactly what to ask for next. Also call this (with just the category filled in) when the user answers a question about which category a pending transaction is for. Never log a transaction any other way.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [...CATEGORIES],
          description:
            "Best-fitting category for this transaction, if it can be determined from the user's text or something actually written on the slip (a memo, bill name, or similar). Omit entirely if a slip shows no purpose at all and nothing else indicates the category — never guess one. The system will then ask the user directly.",
        },
        amount: {
          type: "number",
          description:
            "Transaction amount in Thai baht, if known from the text or a slip image. Always positive. Omit only if truly not yet stated anywhere.",
        },
        description: {
          type: "string",
          description:
            "Short free-text note, e.g. bill name or purpose. Only include what the user actually stated or what's explicitly written on a slip/receipt image — never invent one. Omit this field entirely if no purpose is stated.",
        },
        date: {
          type: "string",
          description:
            "ISO 8601 date (YYYY-MM-DD) the transaction happened on. Omit to use today.",
        },
        referenceNumber: {
          type: "string",
          description:
            "The bank/wallet transaction reference number (รหัสอ้างอิง) shown on a slip, if visible. Copy it exactly as printed, character for character. Omit if not shown or not applicable (e.g. a plain text message with no slip).",
        },
      },
    },
  },
  {
    name: "submit_member_info",
    description:
      "Call when the user provides their full name and cooperative member number — either proactively, or in answer to being asked for it. Never call this for any other reason.",
    input_schema: {
      type: "object",
      properties: {
        fullName: {
          type: "string",
          description: "The member's full name (ชื่อ-นามสกุล), copied as stated.",
        },
        memberNumber: {
          type: "string",
          description: "The member's cooperative member number (เลขสมาชิก), copied as stated.",
        },
      },
      required: ["fullName", "memberNumber"],
    },
  },
  {
    name: "submit_loan_type",
    description:
      "Call when the user specifies which type of loan an in-progress ชำระหนี้ (debt repayment) transaction is for. Map their wording to the closest of the fixed options.",
    input_schema: {
      type: "object",
      properties: {
        loanType: {
          type: "string",
          enum: [...LOAN_TYPES],
          description: "Best-matching loan type from the fixed list.",
        },
      },
      required: ["loanType"],
    },
  },
  {
    name: "decline_unreadable_image",
    description:
      "Use only for an image that genuinely isn't a bank/wallet transaction slip at all (a random unrelated photo, a document, or a slip whose own text explicitly says the transaction failed/is pending/was cancelled). Call this instead of replying with plain text — your reply text afterward explains why to the user.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Short reason, e.g. 'not a transaction slip' or 'slip explicitly shows failed/pending status'.",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "get_transaction_summary",
    description:
      "Look up totals from the user's own previously recorded transactions, optionally filtered by date range and/or category. Use this when the user asks about their own spending, debt, or savings history.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "ISO 8601 start date (YYYY-MM-DD), inclusive.",
        },
        to: {
          type: "string",
          description: "ISO 8601 end date (YYYY-MM-DD), inclusive.",
        },
        category: {
          type: "string",
          enum: [...CATEGORIES],
        },
      },
    },
  },
  {
    name: "set_nickname",
    description:
      "Use only when the user explicitly asks to set or change their own nickname/display name for this bot (e.g. 'เปลี่ยนชื่อเรียกฉันเป็น...', 'ตั้งชื่อเล่นว่า...', 'เรียกฉันว่า...'). Never call this for any other reason — it does not log a transaction and has nothing to do with member info.",
    input_schema: {
      type: "object",
      properties: {
        nickname: {
          type: "string",
          description: "The exact nickname the user asked to be called, copied as stated.",
        },
      },
      required: ["nickname"],
    },
  },
];

type LineUserInfo = {
  fullName: string | null;
  memberNumber: string | null;
};

type PendingInfo = {
  category: string | null;
  amount: number | null;
  description: string | null;
  date: Date | null;
  hasSlip: boolean;
  slipImageHash: string | null;
  slipImageUrl: string | null;
  referenceNumber: string | null;
  loanType: string | null;
};

type Requirement = "member_info" | "slip" | "category" | "loan_type" | null;

function computeNextRequirement(
  lineUser: LineUserInfo | null,
  pending: PendingInfo
): Requirement {
  if (!lineUser?.fullName || !lineUser?.memberNumber) return "member_info";
  if (!pending.hasSlip) return "slip";
  if (!pending.category) return "category";
  if (pending.category === "ชำระหนี้" && !pending.loanType) return "loan_type";
  return null;
}

// slipImageUrl is the best-effort Vercel Blob backup (null if
// BLOB_READ_WRITE_TOKEN isn't set or the upload failed) — never treat it as
// evidence of whether a slip was shown; use hasSlipImage for that.
type ToolContext = {
  lineUserId: string;
  slipImageUrl: string | null;
  slipImageHash: string | null;
  hasSlipImage: boolean;
};

function buildSystemPrompt(
  lineUser: LineUserInfo | null,
  pending: PendingInfo | null
): string {
  const today = new Date().toISOString().slice(0, 10);

  let flowNote = "";
  if (pending) {
    const next = computeNextRequirement(lineUser, pending);
    const amountNote = pending.amount ? formatAmount(pending.amount) : "ยังไม่ทราบยอด";
    if (next === "member_info") {
      flowNote = `\n\nหมายเหตุระบบ (สำคัญ): มีธุรกรรมค้างอยู่ (${pending.category ?? "ยังไม่ทราบหมวดหมู่"}, ${amountNote}) กำลังรอข้อมูลสมาชิก (ชื่อ-นามสกุล และเลขสมาชิก) — นี่คือครั้งแรกที่ผู้ใช้คนนี้ทำธุรกรรม ถ้าข้อความปัจจุบันของผู้ใช้เป็นข้อความธรรมดาที่มีชื่อ-นามสกุลและเลขสมาชิกอยู่แล้ว ให้เรียก submit_member_info ทันทีด้วยข้อมูลนั้น ถ้าเป็นข้อความธรรมดาที่ไม่มีชื่อ-นามสกุลและเลขสมาชิก ให้ถามชื่อ-นามสกุลและเลขสมาชิกอีกครั้งสั้นๆ โดยไม่ต้องเรียก tool ใดๆ **ถ้าข้อความนี้เป็นรูปภาพ (สลิปใหม่) ให้ตรวจสอบตามกฎขั้นที่ 1-1.5 ด้านล่างตามปกติแล้วเรียก report_transaction เพื่อบันทึกข้อมูลสลิปไว้ก่อน (หรือ decline_unreadable_image ถ้าสลิปไม่ถูกต้องจริงๆ) — ระบบจะเก็บสลิปนี้ไว้และถามชื่อ-นามสกุล/เลขสมาชิกในข้อความถัดไปเอง ห้ามปฏิเสธสลิปที่ถูกต้องเพียงเพราะยังไม่มีข้อมูลสมาชิก**`;
    } else if (next === "slip") {
      flowNote = `\n\nหมายเหตุระบบ (สำคัญ): มีธุรกรรมค้างอยู่ (${pending.category ?? "ยังไม่ทราบหมวดหมู่"}, ${amountNote}) ข้อมูลสมาชิกครบแล้ว กำลังรอรูปสลิปการโอนเงิน ถ้าข้อความนี้เป็นรูปภาพ ให้ตรวจสอบตามกฎในขั้นที่ 1-4 ด้านล่างแล้วเรียก report_transaction (พร้อมส่ง category เดิมคือ "${pending.category}" ซ้ำไปด้วย) หรือ decline_unreadable_image ถ้าไม่ใช่สลิปที่ถูกต้อง ถ้าข้อความนี้ไม่ใช่รูปภาพ ให้ขอให้ผู้ใช้ส่งรูปสลิปการโอนเงินอีกครั้งสั้นๆ โดยไม่ต้องเรียก tool ใดๆ`;
    } else if (next === "category") {
      flowNote = `\n\nหมายเหตุระบบ (สำคัญ): มีธุรกรรมค้างอยู่ (${amountNote}) ได้รับสลิปแล้วแต่สลิปไม่ได้ระบุจุดประสงค์/หมายเหตุไว้เลย ทำให้ยังไม่ทราบว่าเป็นธุรกรรมหมวดไหน ถ้าข้อความปัจจุบันของผู้ใช้ระบุว่าเป็นธุรกรรมประเภทไหน (${CATEGORIES.join(
        ", "
      )} หรือความหมายใกล้เคียง) ให้เรียก report_transaction ทันทีโดยใส่ category ตามที่ตอบมา (ไม่ต้องใส่ amount ซ้ำ ระบบมีอยู่แล้ว) ถ้ายังไม่ชัดเจนให้ถามย้ำสั้นๆ พร้อมบอกตัวเลือกทั้งหมด ห้ามเดาหมวดหมู่เองเด็ดขาด`;
    } else if (next === "loan_type") {
      flowNote = `\n\nหมายเหตุระบบ (สำคัญ): มีธุรกรรมชำระหนี้ค้างอยู่ (${amountNote}) ข้อมูลสมาชิกและสลิปครบแล้ว กำลังรอประเภทเงินกู้ ตัวเลือกคือ: ${LOAN_TYPES.join(
        ", "
      )} ถ้าข้อความปัจจุบันของผู้ใช้ระบุประเภทเงินกู้ (หรือความหมายใกล้เคียง) ให้เรียก submit_loan_type ทันทีโดยเลือกตัวเลือกที่ใกล้เคียงที่สุด ถ้ายังไม่ชัดเจนให้ถามย้ำสั้นๆ พร้อมบอกตัวเลือกทั้ง 5 แบบ`;
    }
  }

  return `คุณคือผู้ช่วยด้านการเงินส่วนตัวที่ทำงานผ่าน LINE ให้กับสหกรณ์ออมทรัพย์ครูหนองคาย จำกัด วันนี้คือวันที่ ${today}

หมวดหมู่ธุรกรรมที่ใช้ในระบบมีเฉพาะ: ${CATEGORIES.join(", ")}

ข้อจำกัดสำคัญที่ต้องรู้: แต่ละข้อความที่ผู้ใช้ส่งเข้ามาถูกประมวลผลแยกจากกันโดยสิ้นเชิง คุณ**ไม่มีความจำ**ข้อความหรือรูปก่อนหน้าเลย ระบบจะบอกสถานะธุรกรรมที่ค้างอยู่ผ่าน "หมายเหตุระบบ" ท้ายพรอมป์นี้เท่านั้น ให้ทำตามหมายเหตุระบบนั้นอย่างเคร่งครัดถ้ามี

หน้าที่ของคุณมี 6 อย่าง:

1. เมื่อผู้ใช้เล่าถึงหรือส่งรูปสลิปธุรกรรมกับสหกรณ์ที่เกิดขึ้นแล้ว (ซื้อหุ้น, ชำระหนี้, ฝากเงิน, ชำระเก็บไม่ได้รายเดือน, ชำระประกัน, ชำระฌาปนกิจ, สสค, สสอค, สสชสอ, สสสก, สสสท) ให้เรียก report_transaction ทันทีเพื่อเริ่ม/อัปเดตการบันทึก **ทุกธุรกรรมต้องผ่านการยืนยันตัวตนสมาชิก (ชื่อ-นามสกุล + เลขสมาชิก, ถามครั้งเดียวแล้วจำไว้ถาวร) และมีรูปสลิปการโอนเงินก่อนจะบันทึกจริงเสมอ — ธุรกรรมชำระหนี้ต้องระบุประเภทเงินกู้เพิ่มด้วย** คุณไม่ต้องตัดสินใจเองว่าต้องขอข้อมูลอะไรต่อ ระบบจะตรวจสอบให้อัตโนมัติหลังจากเรียก tool แล้วบอกกลับมาว่ายังขาดอะไร ให้ทำตามนั้น
2. เมื่อผู้ใช้ให้ชื่อ-นามสกุลและเลขสมาชิก (ไม่ว่าจะเสนอเองหรือตอบคำถามที่ถามไป) ให้เรียก submit_member_info
3. เมื่อผู้ใช้ระบุประเภทเงินกู้สำหรับธุรกรรมชำระหนี้ที่ค้างอยู่ ให้เรียก submit_loan_type
4. เมื่อผู้ใช้ถามเกี่ยวกับประวัติการเงินของตัวเอง (เช่น "เดือนนี้จ่ายหนี้ไปเท่าไหร่") ให้เรียกใช้ get_transaction_summary แล้วสรุปคำตอบเป็นภาษาไทย
5. เมื่อผู้ใช้ถามคำถามความรู้ทั่วไปเกี่ยวกับการเงิน (เช่น อัตราดอกเบี้ย, วิธีลงทุน, การกู้ยืม) ที่ไม่เกี่ยวกับข้อมูลส่วนตัวของเขา ให้ตอบด้วยความรู้ทั่วไปโดยตรง ไม่ต้องเรียกเครื่องมือใดๆ และควรระบุว่าเป็นข้อมูลทั่วไป ไม่ใช่คำแนะนำทางการเงินจากผู้เชี่ยวชาญที่มีใบอนุญาต
6. เมื่อผู้ใช้ขอเปลี่ยน/ตั้งชื่อเล่นของตัวเอง (เช่น "เปลี่ยนชื่อเรียกฉันเป็น...", "ตั้งชื่อเล่นว่า...") ให้เรียก set_nickname ด้วยชื่อที่ผู้ใช้ระบุ แล้วตอบยืนยันสั้นๆ ห้ามเรียก tool นี้เพื่อเหตุผลอื่นนอกจากนี้เด็ดขาด (คนละเรื่องกับชื่อ-นามสกุลสมาชิกในข้อ 2)

กฎการตรวจสอบรูปสลิป (ใช้ทุกครั้งที่มีรูปภาพเข้ามา ไม่ว่าจะอยู่ขั้นตอนไหนของการเก็บข้อมูล):

ขั้นที่ 1 (สำคัญที่สุด — ตัดสินก่อนเรื่องอื่นทั้งหมด) ตัดสินใจว่าสลิปนี้"สำเร็จ"หรือไม่: แอปธนาคาร/กระเป๋าเงินดิจิทัลของไทยทุกเจ้า ไม่ว่าจะเป็นธนาคารใด หรือแอปอย่างเป๋าตังก์ (Paotang), ทรูมันนี่, LINE Pay ฯลฯ (ไม่ใช่แค่รายชื่อตัวอย่างเช่น K PLUS, SCB Easy, Krungthai NEXT, Bualuang mBanking, ttb touch, MyMo, Krungsri App) มีสลิปหน้าตาและถ้อยคำไม่เหมือนกัน **กฎเดียวที่ใช้ตัดสิน**: สแกนหาคำหรือวลีที่ลงท้ายด้วย "สำเร็จ" (เช่น "โอนเงินสำเร็จ", "จ่ายบิลสำเร็จ", "ชำระเงินสำเร็จ", "เติมเงินสำเร็จ", "รายการสำเร็จ" หรือความหมายใกล้เคียง) หรือเครื่องหมายถูก/checkmark สีเขียว **ถ้าเจออย่างใดอย่างหนึ่งในภาพ ให้ถือว่าสำเร็จเสมอทันที** ไม่ว่าธนาคารไหน ประเภทธุรกรรมอะไร หรือพื้นหลัง/ธีม/โลโก้/ภาพตกแต่งจะเป็นแบบใดก็ตาม — **ห้ามปฏิเสธการบันทึกด้วยเหตุผลว่า "ไม่เห็นคำยืนยัน" ถ้าจริงๆ แล้วมีคำว่า "สำเร็จ" หรือเครื่องหมายถูกอยู่ในภาพ** ปฏิเสธการบันทึกเฉพาะกรณีที่ข้อความในสลิปเองชัดเจนว่ายังไม่สำเร็จ/ถูกยกเลิก/รอดำเนินการ หรืออ่านจำนวนเงินไม่ออกจริงๆ เท่านั้น — กรณีปฏิเสธเหล่านี้ **ต้องเรียก decline_unreadable_image เสมอ ห้ามตอบเป็นข้อความเปล่าๆ โดยไม่เรียก tool ใดเลยเด็ดขาด** (รูปภาพที่เป็นสลิปทุกรูปต้องจบด้วยการเรียก tool ตัวใดตัวหนึ่งในสองตัวนี้เท่านั้น: report_transaction หรือ decline_unreadable_image) **แอปธนาคารไทยหลายเจ้านิยมใส่ภาพพื้นหลังตกแต่งสไตล์ต่างๆ ทับหน้าจอสลิปตัวเอง (เช่น ธีมกีฬา, ธีมเทศกาล, ธีมโปรโมชั่น, ลายการ์ตูน) ซึ่งเป็นแค่ "สกิน/ธีมกราฟิก" ของแอปที่ไม่เกี่ยวข้องกับตัวธุรกรรมเลย ห้ามตีความว่าพื้นหลังธีมกีฬา/เทศกาล/โปรโมชั่นเหล่านี้ทำให้สลิปกลายเป็น "ข่าว", "โปรโมชั่น", "ตั๋ว", หรือเนื้อหาที่ไม่ใช่ธุรกรรมจริงเด็ดขาด — ถ้าเห็นกล่องข้อความยืนยันการโอน/จ่ายเงิน (มีคำว่า "สำเร็จ" + เครื่องหมายถูก + จำนวนเงิน + เลขที่รายการ) ซ้อนทับอยู่บนพื้นหลังธีมใดๆ ก็ตาม ให้ถือเป็นธุรกรรมจริงเสมอ ไม่ว่าพื้นหลังจะเป็นภาพอะไร** ห้ามใช้ภาพพื้นหลังหรือโลโก้มาตัดสินว่าเป็นตั๋ว/ใบสมัครสมาชิก/ข่าว/เอกสารอื่นเด็ดขาด ให้ดูเฉพาะข้อความและตัวเลขที่เป็นเนื้อหาจริงเท่านั้น **ห้ามพยายามตัดสินว่าธุรกรรมเป็นเงินเข้าหรือเงินออก (รับเงินหรือจ่ายเงิน) จากช่อง "จาก"/"ไปยัง" หรือชื่อบัญชีเด็ดขาด เพราะคุณไม่มีทางรู้ได้จริงว่าชื่อไหนในสลิปคือตัวผู้ใช้เอง ห้ามปฏิเสธหรือถามย้อนกลับด้วยเหตุผลเรื่องทิศทางเงินเข้า-ออกเด็ดขาด** (กฎข้อนี้พูดถึงทิศทางเงินเท่านั้น — แยกจากขั้นที่ 1.5 ด้านล่างซึ่งเป็นการตรวจสอบว่าโอนเข้าบัญชีที่ถูกต้องหรือไม่ ต้องทำทุกครั้ง)

ขั้นที่ 1.5 (สำคัญ — ตรวจทุกครั้งหลังผ่านขั้นที่ 1) ตรวจสอบว่าบัญชี/ผู้รับเงินปลายทาง (ช่อง "ไปยัง" หรือเทียบเท่าในสลิป) คือ **สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด** เท่านั้น ยอมรับชื่อแบบเต็ม แบบย่อ หรือสะกดใกล้เคียงที่สื่อถึงสหกรณ์นี้ชัดเจน (เช่น "สหกรณ์ออมทรัพย์ครูหนองคาย", "สอ.ครูหนองคาย") **ถ้าผู้รับเงินในสลิปเป็นบุคคล ร้านค้า หรือหน่วยงาน/บัญชีอื่นที่ไม่ใช่สหกรณ์นี้อย่างชัดเจน ให้เรียก decline_unreadable_image ทันที** ด้วยเหตุผลว่าไม่ได้โอนเข้าบัญชีสหกรณ์ ห้ามเรียก report_transaction บันทึกธุรกรรมที่ไม่ได้โอนเข้าบัญชีสหกรณ์เด็ดขาด ไม่ว่าหมวดหมู่จะเป็นอะไรก็ตาม ถ้าสลิปไม่แสดงชื่อบัญชีปลายทางให้เห็นเลย (อ่านไม่ออก/ไม่มีในภาพ) ให้ดำเนินการต่อตามปกติโดยไม่ต้องปฏิเสธ เพราะไม่มีหลักฐานว่าโอนผิดบัญชี

ขั้นที่ 2 กำหนดหมวดหมู่ตามบริบทที่เห็นในสลิปจริงๆ ถ้ามีระบุไว้ (เช่น ข้อความหมายเหตุการโอน, ชื่อบิลที่จ่าย) แล้วเรียก report_transaction ทันที

ขั้นที่ 3 กฎการเขียน description: **ชื่อบุคคลหรือชื่อบัญชีของผู้รับโอน/ผู้ส่งเงิน (เช่น ข้อความในช่อง "ไปยัง"/"จาก") ไม่ใช่จุดประสงค์การโอน ห้ามนำมาใส่เป็น description และห้ามต่อเติม/เดาให้กลายเป็นชื่ออื่นที่ฟังดูสมเหตุสมผลกว่าเดิมเด็ดขาด** description ต้องคัดลอกเฉพาะข้อความหมายเหตุ/บันทึกการโอนที่เห็นในสลิปตามตัวอักษรเป๊ะๆ เท่านั้น ห้ามเดา ห้ามเติมคำ ห้ามขยายความแม้แต่คำเดียว ถ้าอ่านไม่ชัดหรือไม่มั่นใจว่าตัวอักษรคืออะไร ให้ปล่อย description ว่างไว้ดีกว่าเดา

ขั้นที่ 4 กันรายการซ้ำ: ถ้าสลิปมีเลขที่รายการ/รหัสอ้างอิง (เช่น "รหัสอ้างอิง", "เลขที่รายการ") ให้คัดลอกใส่ referenceNumber ตามตัวอักษรเป๊ะๆ ระบบจะเช็คให้อัตโนมัติว่าเคยบันทึกสลิปนี้ไปแล้วหรือยัง ถ้า report_transaction แจ้งกลับมาว่าเป็นรายการซ้ำ ให้บอกผู้ใช้ตรงๆ ว่าเคยบันทึกรายการนี้ไปแล้ว ไม่ต้องบันทึกซ้ำอีก

ขั้นที่ 5 ยอดเงินต้องตรงกัน: ให้ใส่ amount เป็นยอดที่อ่านได้จากสลิปจริงเสมอเมื่อมีรูปภาพ (ไม่ใช่ยอดที่ผู้ใช้เคยพิมพ์บอกไว้ก่อนหน้า) ถ้ายอดในสลิปไม่ตรงกับยอดที่ผู้ใช้เคยแจ้งไว้ทางข้อความ ระบบจะตรวจพบเองและแจ้งกลับมาให้คุณถามผู้ใช้ยืนยันยอดที่ถูกต้องก่อนบันทึก ไม่ต้องพยายามตัดสินใจเองว่ายอดไหนถูก

ตอบสั้น กระชับ เป็นกันเอง และเป็นภาษาไทยเสมอ เว้นแต่ผู้ใช้พิมพ์มาเป็นภาษาอื่น${flowNote}`;
}

const PENDING_TRANSACTION_EXPIRY_MS = 30 * 60 * 1000;

async function loadLineUser(lineUserId: string): Promise<LineUserInfo | null> {
  const user = await prisma.lineUser.findUnique({
    where: { id: lineUserId },
    select: { fullName: true, memberNumber: true },
  });
  return user;
}

async function loadPending(lineUserId: string): Promise<PendingInfo | null> {
  const pending = await prisma.pendingTransaction.findUnique({
    where: { lineUserId },
  });
  if (!pending) return null;
  if (Date.now() - pending.createdAt.getTime() > PENDING_TRANSACTION_EXPIRY_MS) {
    await prisma.pendingTransaction.delete({ where: { lineUserId } }).catch(() => {});
    return null;
  }
  return pending;
}

// Creates the Expense row from a now-complete pending transaction plus the
// member's saved identity, then clears the pending record. Shared by every
// tool handler that might supply the last missing piece of information.
async function finalizeTransaction(
  lineUserId: string,
  pending: PendingInfo,
  lineUser: LineUserInfo
): Promise<string> {
  if (
    typeof pending.amount !== "number" ||
    !Number.isFinite(pending.amount) ||
    pending.amount <= 0
  ) {
    return "Error: amount is missing or invalid — ask the user for the transaction amount.";
  }
  if (!pending.category) {
    return "Error: category is missing — ask the user what this transaction was for.";
  }

  try {
    const expense = await prisma.expense.create({
      data: {
        amount: pending.amount,
        category: pending.category,
        description: pending.description,
        date: pending.date ?? new Date(),
        lineUserId,
        referenceNumber: pending.referenceNumber,
        slipImageHash: pending.slipImageHash,
        slipImageUrl: pending.slipImageUrl,
        memberFullName: lineUser.fullName,
        memberNumber: lineUser.memberNumber,
        loanType: pending.loanType,
      },
    });
    await prisma.pendingTransaction.delete({ where: { lineUserId } }).catch(() => {});

    return `Logged: ${formatAmount(expense.amount)} (${expense.category}) on ${expense.date
      .toISOString()
      .slice(0, 10)} for member ${lineUser.fullName} (${lineUser.memberNumber}).`;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      ((err.meta?.target as string[] | undefined)?.includes("referenceNumber") ||
        (err.meta?.target as string[] | undefined)?.includes("slipImageHash"))
    ) {
      await prisma.pendingTransaction.delete({ where: { lineUserId } }).catch(() => {});
      return "Error: this exact transaction (same slip image or same reference number) was already recorded — this looks like a duplicate slip. Tell the user it was already logged and do not log it again.";
    }
    throw err;
  }
}

function requirementMessage(next: Requirement): string {
  if (next === "member_info") {
    return "Still missing: member full name and member number. Ask the user for their ชื่อ-นามสกุล and เลขสมาชิก next, in Thai. Do not log yet.";
  }
  if (next === "slip") {
    return "Still missing: a photo of the transfer slip. Ask the user to send it next, in Thai. Do not log yet.";
  }
  if (next === "category") {
    return `Still missing: which category this transaction is for — the slip showed no stated purpose. Ask the user directly, in Thai, listing the options: ${CATEGORIES.join(
      ", "
    )}. Do not guess. Do not log yet.`;
  }
  if (next === "loan_type") {
    return `Still missing: loan type for this ชำระหนี้ repayment. Ask the user to specify one of: ${LOAN_TYPES.join(
      ", "
    )}. Do not log yet.`;
  }
  return "";
}

type ReportTransactionInput = {
  category?: unknown;
  amount?: unknown;
  description?: unknown;
  date?: unknown;
  referenceNumber?: unknown;
};

async function reportTransaction(
  input: ReportTransactionInput,
  ctx: ToolContext
): Promise<string> {
  const { category, amount, description, date, referenceNumber } = input;

  // category is optional — a slip with no stated purpose legitimately has
  // none yet, and the system will ask the user for it (computeNextRequirement
  // returns "category"). Only reject a category that was actually supplied
  // but isn't one of the fixed options.
  if (
    category !== undefined &&
    (typeof category !== "string" ||
      !CATEGORIES.includes(category as (typeof CATEGORIES)[number]))
  ) {
    return `Error: category must be one of ${CATEGORIES.join(", ")}.`;
  }
  const parsedCategory = typeof category === "string" ? category : null;

  const parsedAmount =
    typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null;
  const parsedDate = typeof date === "string" && date ? new Date(date) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    return "Error: invalid date.";
  }
  const refNumber =
    typeof referenceNumber === "string" && referenceNumber ? referenceNumber : null;
  const parsedDescription =
    typeof description === "string" && description ? description : null;

  // Catch a duplicate slip as early as possible instead of only at the
  // final commit, which may be several messages away once member info and
  // loan type are also collected. Check the image hash first — it's exact
  // and doesn't depend on the model reading the same reference number
  // twice, which isn't guaranteed across two separate OCR passes.
  if (ctx.slipImageHash) {
    const existingByHash = await prisma.expense.findUnique({
      where: { slipImageHash: ctx.slipImageHash },
    });
    if (existingByHash) {
      return "Error: this exact slip image was already recorded previously — this is a duplicate. Tell the user it was already logged and do not log or hold it again.";
    }
  }
  if (refNumber) {
    const existing = await prisma.expense.findUnique({ where: { referenceNumber: refNumber } });
    if (existing) {
      return "Error: a transaction with this exact reference number was already recorded — this looks like a duplicate slip. Tell the user it was already logged and do not log or hold it again.";
    }
  }

  // If an amount was already on record for this pending transaction (e.g.
  // stated in an earlier text message) and this call reports a different
  // one (typically the amount actually read off a slip), don't silently
  // pick one — the newer value wins (the slip is verifiable evidence) but
  // the discrepancy is surfaced to the user rather than logged unnoticed.
  const existingPending = await prisma.pendingTransaction.findUnique({
    where: { lineUserId: ctx.lineUserId },
  });
  const amountMismatch =
    existingPending?.amount != null &&
    parsedAmount !== null &&
    Math.abs(existingPending.amount - parsedAmount) > 0.005;
  const mismatchNote = amountMismatch
    ? ` Note: the amount previously on record (${formatAmount(
        existingPending!.amount!
      )}) doesn't match the amount just reported (${formatAmount(
        parsedAmount!
      )}) — the new amount is now used. Point out this discrepancy to the user in your reply so they can correct it if it's wrong.`
    : "";

  const slipImageUrl = ctx.slipImageUrl;

  const pending = await prisma.pendingTransaction.upsert({
    where: { lineUserId: ctx.lineUserId },
    create: {
      lineUserId: ctx.lineUserId,
      category: parsedCategory,
      amount: parsedAmount,
      description: parsedDescription,
      date: parsedDate,
      hasSlip: ctx.hasSlipImage,
      slipImageHash: ctx.slipImageHash,
      slipImageUrl,
      referenceNumber: refNumber,
    },
    update: {
      // Only overwrite fields we actually have new info for, so a slip
      // arriving after the amount was already known from text (or vice
      // versa) doesn't clobber it with null.
      ...(parsedCategory !== null ? { category: parsedCategory } : {}),
      ...(parsedAmount !== null ? { amount: parsedAmount } : {}),
      ...(parsedDescription !== null ? { description: parsedDescription } : {}),
      date: parsedDate,
      // Only ever set to true, never back to false, once a slip has been
      // seen for this pending transaction.
      ...(ctx.hasSlipImage ? { hasSlip: true } : {}),
      ...(ctx.slipImageHash ? { slipImageHash: ctx.slipImageHash } : {}),
      ...(slipImageUrl ? { slipImageUrl } : {}),
      ...(refNumber ? { referenceNumber: refNumber } : {}),
      createdAt: new Date(),
    },
  });

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeNextRequirement(lineUser, pending);
  if (next === null) {
    const result = await finalizeTransaction(ctx.lineUserId, pending, lineUser as LineUserInfo);
    return result + mismatchNote;
  }
  return requirementMessage(next) + mismatchNote;
}

type SubmitMemberInfoInput = {
  fullName?: unknown;
  memberNumber?: unknown;
};

async function submitMemberInfo(
  input: SubmitMemberInfoInput,
  ctx: ToolContext
): Promise<string> {
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const memberNumber =
    typeof input.memberNumber === "string" ? input.memberNumber.trim() : "";
  if (!fullName || !memberNumber) {
    return "Error: both fullName and memberNumber must be non-empty strings.";
  }

  await prisma.lineUser.upsert({
    where: { id: ctx.lineUserId },
    create: { id: ctx.lineUserId, fullName, memberNumber },
    update: { fullName, memberNumber },
  });

  const pending = await loadPending(ctx.lineUserId);
  if (!pending) {
    return `Member info saved (${fullName}, ${memberNumber}). No transaction is currently in progress — just confirm to the user that their info was saved.`;
  }

  const next = computeNextRequirement({ fullName, memberNumber }, pending);
  if (next === null) {
    return await finalizeTransaction(ctx.lineUserId, pending, { fullName, memberNumber });
  }
  return requirementMessage(next);
}

type SubmitLoanTypeInput = {
  loanType?: unknown;
};

async function submitLoanType(
  input: SubmitLoanTypeInput,
  ctx: ToolContext
): Promise<string> {
  const loanType =
    typeof input.loanType === "string" &&
    LOAN_TYPES.includes(input.loanType as (typeof LOAN_TYPES)[number])
      ? input.loanType
      : null;
  if (!loanType) {
    return `Error: loanType must be one of ${LOAN_TYPES.join(", ")}.`;
  }

  const pending = await loadPending(ctx.lineUserId);
  if (!pending || pending.category !== "ชำระหนี้") {
    return "Error: no in-progress ชำระหนี้ transaction to attach a loan type to.";
  }

  const updated = await prisma.pendingTransaction.update({
    where: { lineUserId: ctx.lineUserId },
    data: { loanType, createdAt: new Date() },
  });

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeNextRequirement(lineUser, updated);
  if (next === null) {
    return await finalizeTransaction(ctx.lineUserId, updated, lineUser as LineUserInfo);
  }
  return requirementMessage(next);
}

type SummaryInput = {
  from?: unknown;
  to?: unknown;
  category?: unknown;
};

async function getTransactionSummary(
  input: SummaryInput,
  lineUserId: string
): Promise<string> {
  const { from, to, category } = input;

  const where: Record<string, unknown> = { lineUserId };

  if (typeof category === "string" && category) {
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return `Error: category must be one of ${CATEGORIES.join(", ")}.`;
    }
    where.category = category;
  }

  if (typeof from === "string" || typeof to === "string") {
    where.date = {
      ...(typeof from === "string" && from ? { gte: new Date(from) } : {}),
      // `to` is a date-only string (e.g. "2026-07-09"), which parses to
      // UTC midnight. Use an exclusive upper bound one day later so the
      // whole day is included instead of only timestamps at/before 00:00.
      ...(typeof to === "string" && to
        ? { lt: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000) }
        : {}),
    };
  }

  const grouped = await prisma.expense.groupBy({
    by: ["category"],
    where,
    _sum: { amount: true },
    _count: true,
  });

  if (grouped.length === 0) {
    return "No matching transactions found for this user in the given range.";
  }

  const total = grouped.reduce((sum, g) => sum + (g._sum.amount ?? 0), 0);
  const breakdown = grouped
    .map(
      (g) =>
        `${g.category}: ${formatAmount(g._sum.amount ?? 0)} (${g._count} records)`
    )
    .join("; ");

  return `Total: ${formatAmount(total)}. Breakdown: ${breakdown}.`;
}

type SetNicknameInput = {
  nickname?: unknown;
};

async function setNickname(
  input: SetNicknameInput,
  ctx: ToolContext
): Promise<string> {
  const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";
  if (!nickname) {
    return "Error: nickname must be a non-empty string.";
  }

  await prisma.lineUser.upsert({
    where: { id: ctx.lineUserId },
    create: { id: ctx.lineUserId, nickname },
    update: { nickname },
  });

  return `Nickname set to "${nickname}".`;
}

async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<string> {
  console.log(`[financeAgent] tool call: ${name}`, JSON.stringify(input));
  try {
    if (name === "report_transaction") {
      return await reportTransaction(input as ReportTransactionInput, ctx);
    }
    if (name === "submit_member_info") {
      return await submitMemberInfo(input as SubmitMemberInfoInput, ctx);
    }
    if (name === "submit_loan_type") {
      return await submitLoanType(input as SubmitLoanTypeInput, ctx);
    }
    if (name === "get_transaction_summary") {
      return await getTransactionSummary(input as SummaryInput, ctx.lineUserId);
    }
    if (name === "set_nickname") {
      return await setNickname(input as SetNicknameInput, ctx);
    }
    if (name === "decline_unreadable_image") {
      const reason =
        typeof (input as { reason?: unknown })?.reason === "string"
          ? (input as { reason: string }).reason
          : "unspecified";
      return `Declined: ${reason}. Explain this to the user in your reply without inventing extra details.`;
    }
    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Error executing ${name}: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

export async function runFinanceAgent(
  userContent: Anthropic.MessageParam["content"],
  lineUserId: string,
  slipImageUrlPromise: Promise<string | null> = Promise.resolve(null),
  slipImageHash: string | null = null
): Promise<string> {
  const [lineUser, pending] = await Promise.all([
    loadLineUser(lineUserId),
    loadPending(lineUserId),
  ]);

  // The caller kicks off the Blob upload before calling this function but
  // doesn't await it, so it runs concurrently with the first Claude API
  // round-trip below instead of blocking it. Only resolve it once a tool
  // call actually needs it.
  let resolvedSlipImageUrl: string | null | undefined;
  async function resolveSlipImageUrl(): Promise<string | null> {
    if (resolvedSlipImageUrl === undefined) {
      resolvedSlipImageUrl = await slipImageUrlPromise;
    }
    return resolvedSlipImageUrl;
  }

  const system = buildSystemPrompt(lineUser, pending);
  const model = hasImageContent(userContent) ? VISION_MODEL : TEXT_MODEL;
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userContent },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    // The model tends to respond with plain text instead of calling a tool
    // when it wants to ask something. Force the specific tool the pending
    // transaction is waiting on so a text reply naming member info / loan
    // type is never silently dropped as a bare text response. Images
    // always need vision judgement (real slip vs. not), so those force
    // "any" tool rather than a single named one.
    let toolChoice: Anthropic.ToolChoice | undefined;
    const next = pending ? computeNextRequirement(lineUser, pending) : null;
    if (turn === 0 && next === "member_info" && !hasImageContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_member_info" };
    } else if (turn === 0 && next === "category" && !hasImageContent(userContent)) {
      toolChoice = { type: "tool", name: "report_transaction" };
    } else if (turn === 0 && next === "loan_type" && !hasImageContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_loan_type" };
    } else if (turn === 0 && hasImageContent(userContent)) {
      toolChoice = { type: "any" };
    }
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      tools,
      messages,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      const text = textBlock?.text.trim();
      console.log(
        `[financeAgent] no tool called on turn ${turn}, replying with text only`
      );
      if (!text) {
        console.error(
          "[financeAgent] empty model response, falling back:",
          JSON.stringify({
            stopReason: response.stop_reason,
            contentTypes: response.content.map((b) => b.type),
          })
        );
      }
      return text || "ขอโทษค่ะ ไม่สามารถตอบได้ในตอนนี้";
    }

    messages.push({ role: "assistant", content: response.content });

    const ctx: ToolContext = {
      lineUserId,
      slipImageUrl: await resolveSlipImageUrl(),
      slipImageHash,
      hasSlipImage: hasImageContent(userContent),
    };
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await executeTool(block.name, block.input, ctx);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // The loop above may have already committed a tool's side effect (e.g.
  // logged an expense) on its final turn without getting a chance to reply.
  // Make one more call with tools disabled so the model must summarize what
  // actually happened instead of the caller returning a generic "failed"
  // message for work that already succeeded.
  const finalResponse = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system,
    messages,
  });
  const finalText = finalResponse.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return finalText?.text.trim() || "ขอโทษค่ะ ดำเนินการไม่สำเร็จ ลองใหม่อีกครั้งนะคะ";
}
