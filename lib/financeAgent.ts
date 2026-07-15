import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { anthropic } from "./anthropicClient";
import { lineClient } from "./lineClient";
import { prisma } from "./prisma";
import { CATEGORIES } from "./categories";
import { LOAN_TYPES } from "./loanTypes";
import { DOCUMENT_TYPES } from "./documentTypes";
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

// สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด's official website — the only domain the
// web_fetch tool below is allowed to reach. Mentioning the literal URL here
// (in the cached static system prompt) is also what satisfies web_fetch's
// requirement that a URL be already present in the conversation before the
// model can fetch it.
const COOPERATIVE_WEBSITE = "https://www.nktscoop.com";

// Mixed array: custom tools (Anthropic.Tool) plus the server-executed
// web_fetch tool below, which is a different variant — Anthropic.Tool alone
// can't type it, hence the wider ToolUnion annotation.
const tools: Anthropic.Messages.ToolUnion[] = [
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
      "Use only for an image that genuinely isn't a bank/wallet transaction slip and isn't one of the known supporting-document types either (a random unrelated photo, or a slip whose own text explicitly says the transaction failed/is pending/was cancelled). For a payslip, ID card copy, house registration copy, or marriage certificate, use flag_supporting_document instead — those aren't declined, they're routed to ask what the user needs. Call this instead of replying with plain text — your reply text afterward explains why to the user.",
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
    name: "flag_supporting_document",
    description:
      "Call when the user sends an image that is a supporting document — a payslip (สลิปเงินเดือน), ID card copy (สำเนาบัตรประชาชน), house registration copy (สำเนาทะเบียนบ้าน), or marriage certificate (ทะเบียนสมรส) — rather than a bank/wallet transfer slip. These are usually submitted for some other cooperative service (e.g. a loan application) that this bot doesn't process directly; it asks what the request is for and forwards it to the right department. Never use this for an actual transfer slip or a genuinely unrelated image.",
    input_schema: {
      type: "object",
      properties: {
        documentType: {
          type: "string",
          enum: [...DOCUMENT_TYPES],
          description: "Best-matching type of supporting document.",
        },
      },
      required: ["documentType"],
    },
  },
  {
    name: "submit_service_purpose",
    description:
      "Call when the user states what request/service a previously-flagged supporting document is for (e.g. 'ขอกู้เงินสามัญ', 'สมัครสมาชิกใหม่'). Only relevant when there's an in-progress supporting-document flow awaiting this.",
    input_schema: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description: "The request/purpose exactly as the user stated it.",
        },
        department: {
          type: "string",
          enum: ["สินเชื่อ", "อื่นๆ"],
          description:
            "Which team should handle this: 'สินเชื่อ' for anything loan-related (กู้เงิน, สินเชื่อ, any loan type), 'อื่นๆ' for everything else (membership, general inquiries, etc.).",
        },
      },
      required: ["purpose", "department"],
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
  // Server-executed, restricted to the cooperative's own domain via
  // allowed_domains so a member can never get the bot to fetch/search
  // arbitrary sites. web_fetch refuses any URL that hasn't already
  // appeared as real content in the conversation (error
  // "url_not_in_prior_context") — mentioning the URL in the system prompt
  // does NOT count, so web_fetch alone always failed. web_search must run
  // first: its results land in the conversation as a genuine tool result,
  // which is what makes the URL fetchable afterward. Both use the basic
  // (non-"_2026...") variant because TEXT_MODEL is Haiku 4.5, which the
  // newer dynamic-filtering variants don't support.
  {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 3,
    allowed_domains: ["www.nktscoop.com", "nktscoop.com"],
  },
  {
    type: "web_fetch_20250910",
    name: "web_fetch",
    max_uses: 2,
    allowed_domains: ["www.nktscoop.com", "nktscoop.com"],
  },
];

type LineUserInfo = {
  fullName: string | null;
  memberNumber: string | null;
  // true when the identity came from MemberRoster keyed by this LINE
  // account's own userId (cryptographically tied to the account, can't be
  // spoofed). false when it's only what the user typed via submit_member_info.
  verified: boolean;
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

// After a reply is produced, re-derive what the bot is now waiting on and
// offer tappable buttons for the pick-one steps (category, loan type) so
// the member selects instead of typing a free-form answer the model then
// has to interpret. Other steps (member info, slip, purpose) are free-form
// or image-based, so no buttons.
async function computeQuickReplies(lineUserId: string): Promise<string[]> {
  const [lineUser, pending] = await Promise.all([
    loadLineUser(lineUserId),
    loadPending(lineUserId),
  ]);
  if (!pending) return [];
  const next = computeNextRequirement(lineUser, pending);
  if (next === "category") return [...CATEGORIES];
  if (next === "loan_type") return [...LOAN_TYPES];
  return [];
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

// Returns the system prompt in two parts: `base` is fully static
// (identical on every call) so it can be prompt-cached, and `dynamic`
// holds the day's date plus the per-message "หมายเหตุระบบ" flow note. The
// caller sends them as two system blocks with a cache breakpoint after
// base, so the large static instructions + tools aren't re-billed at full
// price on every message.
function buildSystemPrompt(
  lineUser: LineUserInfo | null,
  pending: PendingInfo | null,
  pendingService: PendingServiceInfo | null
): { base: string; dynamic: string } {
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
  } else if (pendingService) {
    const next = computeServiceRequirement(lineUser, pendingService);
    if (next === "purpose") {
      flowNote = `\n\nหมายเหตุระบบ (สำคัญ): ผู้ใช้เพิ่งส่งเอกสารประกอบ (${pendingService.documentType}) มา ยังไม่ทราบว่าต้องการทำรายการอะไร ถ้าข้อความปัจจุบันของผู้ใช้ระบุว่าต้องการทำอะไร (เช่น ขอกู้เงิน, สมัครสมาชิก) ให้เรียก submit_service_purpose ทันทีด้วยข้อความนั้น พร้อมระบุ department ด้วย: "สินเชื่อ" ถ้าเกี่ยวกับเงินกู้ไม่ว่าประเภทไหน หรือ "อื่นๆ" ถ้าไม่เกี่ยวกับเงินกู้ ถ้ายังไม่ชัดเจนให้ถามย้ำสั้นๆ ด้วยคำสุภาพว่าต้องการทำรายการอะไร`;
    } else if (next === "member_info") {
      flowNote = `\n\nหมายเหตุระบบ (สำคัญ): ผู้ใช้ต้องการทำรายการ "${pendingService.requestType}" (จากเอกสาร ${pendingService.documentType}) ทราบจุดประสงค์แล้ว แต่ยังต้องขอชื่อ-นามสกุลและเลขสมาชิกก่อนจะส่งต่อให้ฝ่ายที่เกี่ยวข้อง ถ้าข้อความปัจจุบันของผู้ใช้มีชื่อ-นามสกุลและเลขสมาชิกอยู่แล้ว ให้เรียก submit_member_info ทันที ถ้ายังไม่มีให้ถามอีกครั้งสั้นๆ`;
    }
  }

  const base = `คุณคือผู้ช่วยด้านการเงินส่วนตัวที่ทำงานผ่าน LINE ให้กับสหกรณ์ออมทรัพย์ครูหนองคาย จำกัด

ข้อมูลอ้างอิงของสหกรณ์ (ข้อมูล ณ สิ้นปี 2568 จากเว็บไซต์สหกรณ์ อาจมีการเปลี่ยนแปลงในภายหลังตามมติคณะกรรมการ):
- อัตราดอกเบี้ยเงินฝาก (ต่อปี): ออมทรัพย์ / ออมทรัพย์ ATM 1.25% | ออมทรัพย์พิเศษ 3.00% | ประจำ 6 เดือน 2.75% | ประจำ 12 เดือน 3.50%
- อัตราดอกเบี้ยเงินกู้ (ต่อปี): ทั่วไป (เงินกู้สามัญ, เพื่อการดำรงชีพ, เพื่อการโอนหนี้, ปรับโครงสร้างหนี้) 5.25% | โครงการพิเศษดอกเบี้ยต่ำ (72 งวด) 4.50%
- สวัสดิการสมาชิก: ทุนการศึกษาบุตรสมาชิกจ่ายเป็นประจำทุกปี, การสงเคราะห์ผ่านสมาคมฌาปนกิจสงเคราะห์สมาชิกสหกรณ์ (ส.ส.ค.), เงินปันผลและเฉลี่ยคืนตามหุ้น/ธุรกิจ
- ข้อมูลติดต่อ: ที่อยู่ 143 ถนนประจักษ์ ตำบลในเมือง อำเภอเมือง จังหวัดหนองคาย 43000 | โทรศัพท์ธุรการ 042-411334, 062-3089190, 098-5841680 | หุ้น-หนี้ 042-420495 | สมาคมฌาปนกิจ (สสค.) 042-413276, 064-8766432 | เว็บไซต์ ${COOPERATIVE_WEBSITE} | อีเมล nktsc.org@gmail.com

หมวดหมู่ธุรกรรมที่ใช้ในระบบมีเฉพาะ: ${CATEGORIES.join(", ")}

ข้อจำกัดสำคัญที่ต้องรู้: แต่ละข้อความที่ผู้ใช้ส่งเข้ามาถูกประมวลผลแยกจากกันโดยสิ้นเชิง คุณ**ไม่มีความจำ**ข้อความหรือรูปก่อนหน้าเลย ระบบจะบอกสถานะธุรกรรมที่ค้างอยู่ผ่าน "หมายเหตุระบบ" ท้ายพรอมป์นี้เท่านั้น ให้ทำตามหมายเหตุระบบนั้นอย่างเคร่งครัดถ้ามี

**กฎที่ห้ามฝ่าฝืนเด็ดขาด**: เมื่อผู้ใช้พิมพ์บอกจำนวนเงิน+หมวดหมู่ธุรกรรม (แม้จะยังไม่มีสลิปก็ตาม) **ห้ามตอบเป็นข้อความเปล่าๆ ถามข้อมูลเพิ่มโดยไม่เรียก report_transaction ก่อนเด็ดขาด** ต่อให้ยอดเงินดูสูงผิดปกติหรือคุณอยากถามอะไรเพิ่มก็ตาม ให้เรียก report_transaction ด้วยข้อมูลที่มีก่อนเสมอ (ระบบจะเก็บยอดนี้ไว้เทียบกับสลิปที่จะตามมาทีหลังเองด้วย) แล้วค่อยใส่คำถามหรือข้อสังเกตของคุณลงในข้อความตอบกลับได้ตามปกติ — การเรียก tool กับการถามคำถามทำพร้อมกันได้ในคำตอบเดียว ไม่ต้องเลือกอย่างใดอย่างหนึ่ง

หน้าที่ของคุณมี 9 อย่าง:

1. เมื่อผู้ใช้เล่าถึงหรือส่งรูปสลิปธุรกรรมกับสหกรณ์ที่เกิดขึ้นแล้ว (ซื้อหุ้น, ชำระหนี้, ฝากเงิน, ชำระเก็บไม่ได้รายเดือน, ชำระประกัน, ชำระฌาปนกิจ, สสค, สสอค, สสชสอ, สสสก, สสสท) ให้เรียก report_transaction ทันทีเพื่อเริ่ม/อัปเดตการบันทึก **ทุกธุรกรรมต้องผ่านการยืนยันตัวตนสมาชิก (ชื่อ-นามสกุล + เลขสมาชิก, ถามครั้งเดียวแล้วจำไว้ถาวร) และมีรูปสลิปการโอนเงินก่อนจะบันทึกจริงเสมอ — ธุรกรรมชำระหนี้ต้องระบุประเภทเงินกู้เพิ่มด้วย** คุณไม่ต้องตัดสินใจเองว่าต้องขอข้อมูลอะไรต่อ ระบบจะตรวจสอบให้อัตโนมัติหลังจากเรียก tool แล้วบอกกลับมาว่ายังขาดอะไร ให้ทำตามนั้น
2. เมื่อผู้ใช้ให้ชื่อ-นามสกุลและเลขสมาชิก (ไม่ว่าจะเสนอเองหรือตอบคำถามที่ถามไป) ให้เรียก submit_member_info
3. เมื่อผู้ใช้ระบุประเภทเงินกู้สำหรับธุรกรรมชำระหนี้ที่ค้างอยู่ ให้เรียก submit_loan_type
4. เมื่อผู้ใช้ส่งรูปที่เป็น**เอกสารประกอบ** (สลิปเงินเดือน, สำเนาบัตรประชาชน, สำเนาทะเบียนบ้าน, ทะเบียนสมรส) แทนที่จะเป็นสลิปโอนเงิน ให้เรียก flag_supporting_document ทันที (ห้ามใช้ decline_unreadable_image สำหรับเอกสารกลุ่มนี้) แล้วถามด้วยคำสุภาพว่าต้องการทำรายการอะไร
5. เมื่อผู้ใช้ตอบว่าเอกสารประกอบนั้นส่งมาเพื่อทำรายการอะไร (เช่น "ขอกู้เงินสามัญ") ให้เรียก submit_service_purpose ด้วยข้อความนั้น
6. เมื่อผู้ใช้ถามเกี่ยวกับประวัติการเงินของตัวเอง (เช่น "เดือนนี้จ่ายหนี้ไปเท่าไหร่") ให้เรียกใช้ get_transaction_summary แล้วสรุปคำตอบเป็นภาษาไทย
7. เมื่อผู้ใช้ถามข้อมูลเกี่ยวกับสหกรณ์เอง (อัตราดอกเบี้ยเงินฝาก/เงินกู้, สวัสดิการสมาชิก, ข้อมูลติดต่อ) **ให้ตอบจาก "ข้อมูลอ้างอิงของสหกรณ์" ด้านบนได้ทันที ไม่ต้องเรียก tool ใดๆ** เพราะเป็นข้อมูลที่เปลี่ยนไม่บ่อย แต่ให้บอกด้วยว่าเป็นข้อมูล ณ สิ้นปี 2568 อาจมีการเปลี่ยนแปลง ถ้าต้องการยืนยันตัวเลขล่าสุดให้ติดต่อสำนักงานสหกรณ์โดยตรง — ถ้าผู้ใช้ถามเรื่องที่ไม่มีในข้อมูลอ้างอิงนี้ (เช่น ข่าวสาร, ประกาศ, กิจกรรมล่าสุด) ให้เรียก web_search ค้นจากเว็บไซต์สหกรณ์ก่อนเสมอ (**ห้ามเรียก web_fetch ตรงๆ เด็ดขาด — web_fetch จะปฏิเสธ URL ที่ยังไม่เคยปรากฏในบทสนทนาจริง ต้องผ่าน web_search มาก่อนเท่านั้น**) ถ้าผลค้นหายังไม่ครบให้เรียก web_fetch ดึงเนื้อหาเต็มจากลิงก์ที่ได้ต่อ แล้วสรุปคำตอบจากเนื้อหาที่ดึงมาได้จริงเท่านั้น ห้ามตอบจากความจำหรือเดา ถ้าค้นหา/ดึงข้อมูลไม่สำเร็จหรือหาคำตอบไม่เจอ ให้บอกตรงๆ ว่าหาไม่พบและแนะนำให้ติดต่อสำนักงานสหกรณ์โดยตรง
8. เมื่อผู้ใช้ถามคำถามความรู้ทั่วไปเกี่ยวกับการเงิน (เช่น วิธีลงทุน, หลักการกู้ยืมทั่วไป) ที่ไม่เกี่ยวกับข้อมูลของสหกรณ์นี้โดยเฉพาะและไม่เกี่ยวกับข้อมูลส่วนตัวของเขา ให้ตอบด้วยความรู้ทั่วไปโดยตรง ไม่ต้องเรียกเครื่องมือใดๆ และควรระบุว่าเป็นข้อมูลทั่วไป ไม่ใช่คำแนะนำทางการเงินจากผู้เชี่ยวชาญที่มีใบอนุญาต
9. เมื่อผู้ใช้ขอเปลี่ยน/ตั้งชื่อเล่นของตัวเอง (เช่น "เปลี่ยนชื่อเรียกฉันเป็น...", "ตั้งชื่อเล่นว่า...") ให้เรียก set_nickname ด้วยชื่อที่ผู้ใช้ระบุ แล้วตอบยืนยันสั้นๆ ห้ามเรียก tool นี้เพื่อเหตุผลอื่นนอกจากนี้เด็ดขาด (คนละเรื่องกับชื่อ-นามสกุลสมาชิกในข้อ 2)

กฎการตรวจสอบรูปสลิป (ใช้ทุกครั้งที่มีรูปภาพเข้ามา ไม่ว่าจะอยู่ขั้นตอนไหนของการเก็บข้อมูล):

ขั้นที่ 0 (เช็คก่อนอย่างอื่นทั้งหมด) ถ้าภาพที่ส่งมาเป็นเอกสารประกอบกลุ่มนี้: **สลิปเงินเดือน, สำเนาบัตรประชาชน, สำเนาทะเบียนบ้าน, ทะเบียนสมรส** (สังเกตจากหัวเอกสาร/รูปแบบ ไม่ใช่สลิปโอนเงินจากธนาคาร/วอลเล็ตเลย) **ให้เรียก flag_supporting_document ทันที แล้วข้ามขั้นที่ 1-4 ด้านล่างไปเลย ห้ามเรียก decline_unreadable_image สำหรับเอกสารกลุ่มนี้เด็ดขาด** — decline_unreadable_image ใช้เฉพาะรูปที่ไม่เกี่ยวกับสหกรณ์เลยหรือสลิปที่ไม่สมบูรณ์เท่านั้น ถ้าภาพไม่ใช่เอกสารกลุ่มนี้ ให้ไปประเมินต่อที่ขั้นที่ 1

ขั้นที่ 1 (สำคัญที่สุด — ตัดสินก่อนเรื่องอื่นทั้งหมด) ตัดสินใจว่าสลิปนี้"สำเร็จ"หรือไม่: แอปธนาคาร/กระเป๋าเงินดิจิทัลของไทยทุกเจ้า ไม่ว่าจะเป็นธนาคารใด หรือแอปอย่างเป๋าตังก์ (Paotang), ทรูมันนี่, LINE Pay ฯลฯ (ไม่ใช่แค่รายชื่อตัวอย่างเช่น K PLUS, SCB Easy, Krungthai NEXT, Bualuang mBanking, ttb touch, MyMo, Krungsri App) มีสลิปหน้าตาและถ้อยคำไม่เหมือนกัน **กฎเดียวที่ใช้ตัดสิน**: สแกนหาคำหรือวลีที่ลงท้ายด้วย "สำเร็จ" (เช่น "โอนเงินสำเร็จ", "จ่ายบิลสำเร็จ", "ชำระเงินสำเร็จ", "เติมเงินสำเร็จ", "รายการสำเร็จ" หรือความหมายใกล้เคียง) หรือเครื่องหมายถูก/checkmark สีเขียว **ถ้าเจออย่างใดอย่างหนึ่งในภาพ ให้ถือว่าสำเร็จเสมอทันที** ไม่ว่าธนาคารไหน ประเภทธุรกรรมอะไร หรือพื้นหลัง/ธีม/โลโก้/ภาพตกแต่งจะเป็นแบบใดก็ตาม — **ห้ามปฏิเสธการบันทึกด้วยเหตุผลว่า "ไม่เห็นคำยืนยัน" ถ้าจริงๆ แล้วมีคำว่า "สำเร็จ" หรือเครื่องหมายถูกอยู่ในภาพ** ปฏิเสธการบันทึกเฉพาะกรณีที่ข้อความในสลิปเองชัดเจนว่ายังไม่สำเร็จ/ถูกยกเลิก/รอดำเนินการ หรืออ่านจำนวนเงินไม่ออกจริงๆ เท่านั้น — กรณีปฏิเสธเหล่านี้ **ต้องเรียก decline_unreadable_image เสมอ ห้ามตอบเป็นข้อความเปล่าๆ โดยไม่เรียก tool ใดเลยเด็ดขาด** (รูปภาพที่ผ่านมาถึงขั้นที่ 1 นี้แล้ว — คือไม่ใช่เอกสารประกอบตามขั้นที่ 0 — ต้องจบด้วยการเรียก tool ตัวใดตัวหนึ่งในสองตัวนี้เท่านั้น: report_transaction หรือ decline_unreadable_image) **แอปธนาคารไทยหลายเจ้านิยมใส่ภาพพื้นหลังตกแต่งสไตล์ต่างๆ ทับหน้าจอสลิปตัวเอง (เช่น ธีมกีฬา, ธีมเทศกาล, ธีมโปรโมชั่น, ลายการ์ตูน) ซึ่งเป็นแค่ "สกิน/ธีมกราฟิก" ของแอปที่ไม่เกี่ยวข้องกับตัวธุรกรรมเลย ห้ามตีความว่าพื้นหลังธีมกีฬา/เทศกาล/โปรโมชั่นเหล่านี้ทำให้สลิปกลายเป็น "ข่าว", "โปรโมชั่น", "ตั๋ว", หรือเนื้อหาที่ไม่ใช่ธุรกรรมจริงเด็ดขาด — ถ้าเห็นกล่องข้อความยืนยันการโอน/จ่ายเงิน (มีคำว่า "สำเร็จ" + เครื่องหมายถูก + จำนวนเงิน + เลขที่รายการ) ซ้อนทับอยู่บนพื้นหลังธีมใดๆ ก็ตาม ให้ถือเป็นธุรกรรมจริงเสมอ ไม่ว่าพื้นหลังจะเป็นภาพอะไร** ห้ามใช้ภาพพื้นหลังหรือโลโก้มาตัดสินว่าเป็นตั๋ว/ใบสมัครสมาชิก/ข่าว/เอกสารอื่นเด็ดขาด ให้ดูเฉพาะข้อความและตัวเลขที่เป็นเนื้อหาจริงเท่านั้น **ห้ามพยายามตัดสินว่าธุรกรรมเป็นเงินเข้าหรือเงินออก (รับเงินหรือจ่ายเงิน) จากช่อง "จาก"/"ไปยัง" หรือชื่อบัญชีเด็ดขาด เพราะคุณไม่มีทางรู้ได้จริงว่าชื่อไหนในสลิปคือตัวผู้ใช้เอง ห้ามปฏิเสธหรือถามย้อนกลับด้วยเหตุผลเรื่องทิศทางเงินเข้า-ออกเด็ดขาด** (กฎข้อนี้พูดถึงทิศทางเงินเท่านั้น — แยกจากขั้นที่ 1.5 ด้านล่างซึ่งเป็นการตรวจสอบว่าโอนเข้าบัญชีที่ถูกต้องหรือไม่ ต้องทำทุกครั้ง)

ขั้นที่ 1.5 (สำคัญ — ตรวจทุกครั้งหลังผ่านขั้นที่ 1) ตรวจสอบว่าบัญชี/ผู้รับเงินปลายทาง (ช่อง "ไปยัง" หรือเทียบเท่าในสลิป) คือ **สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด** เท่านั้น ยอมรับชื่อแบบเต็ม แบบย่อ หรือสะกดใกล้เคียงที่สื่อถึงสหกรณ์นี้ชัดเจน (เช่น "สหกรณ์ออมทรัพย์ครูหนองคาย", "สอ.ครูหนองคาย") **ถ้าผู้รับเงินในสลิปเป็นบุคคล ร้านค้า หรือหน่วยงาน/บัญชีอื่นที่ไม่ใช่สหกรณ์นี้อย่างชัดเจน ให้เรียก decline_unreadable_image ทันที** ด้วยเหตุผลว่าไม่ได้โอนเข้าบัญชีสหกรณ์ ห้ามเรียก report_transaction บันทึกธุรกรรมที่ไม่ได้โอนเข้าบัญชีสหกรณ์เด็ดขาด ไม่ว่าหมวดหมู่จะเป็นอะไรก็ตาม ถ้าสลิปไม่แสดงชื่อบัญชีปลายทางให้เห็นเลย (อ่านไม่ออก/ไม่มีในภาพ) ให้ดำเนินการต่อตามปกติโดยไม่ต้องปฏิเสธ เพราะไม่มีหลักฐานว่าโอนผิดบัญชี

ขั้นที่ 2 กำหนดหมวดหมู่ตามบริบทที่เห็นในสลิปจริงๆ ถ้ามีระบุไว้ (เช่น ข้อความหมายเหตุการโอน, ชื่อบิลที่จ่าย) แล้วเรียก report_transaction ทันที

ขั้นที่ 3 กฎการเขียน description: **ชื่อบุคคลหรือชื่อบัญชีของผู้รับโอน/ผู้ส่งเงิน (เช่น ข้อความในช่อง "ไปยัง"/"จาก") ไม่ใช่จุดประสงค์การโอน ห้ามนำมาใส่เป็น description และห้ามต่อเติม/เดาให้กลายเป็นชื่ออื่นที่ฟังดูสมเหตุสมผลกว่าเดิมเด็ดขาด** description ต้องคัดลอกเฉพาะข้อความหมายเหตุ/บันทึกการโอนที่เห็นในสลิปตามตัวอักษรเป๊ะๆ เท่านั้น ห้ามเดา ห้ามเติมคำ ห้ามขยายความแม้แต่คำเดียว ถ้าอ่านไม่ชัดหรือไม่มั่นใจว่าตัวอักษรคืออะไร ให้ปล่อย description ว่างไว้ดีกว่าเดา

ขั้นที่ 4 กันรายการซ้ำ: ถ้าสลิปมีเลขที่รายการ/รหัสอ้างอิง (เช่น "รหัสอ้างอิง", "เลขที่รายการ") ให้คัดลอกใส่ referenceNumber ตามตัวอักษรเป๊ะๆ ระบบจะเช็คให้อัตโนมัติว่าเคยบันทึกสลิปนี้ไปแล้วหรือยัง ถ้า report_transaction แจ้งกลับมาว่าเป็นรายการซ้ำ ให้บอกผู้ใช้ตรงๆ ว่าเคยบันทึกรายการนี้ไปแล้ว ไม่ต้องบันทึกซ้ำอีก

ขั้นที่ 5 ยอดเงินต้องตรงกัน: ให้ใส่ amount เป็นยอดที่อ่านได้จากสลิปจริงเสมอเมื่อมีรูปภาพ (ไม่ใช่ยอดที่ผู้ใช้เคยพิมพ์บอกไว้ก่อนหน้า) ถ้ายอดในสลิปไม่ตรงกับยอดที่ผู้ใช้เคยแจ้งไว้ทางข้อความ ระบบจะตรวจพบเองและแจ้งกลับมาให้คุณถามผู้ใช้ยืนยันยอดที่ถูกต้องก่อนบันทึก ไม่ต้องพยายามตัดสินใจเองว่ายอดไหนถูก

ตอบสั้น กระชับ เป็นกันเอง และเป็นภาษาไทยเสมอ เว้นแต่ผู้ใช้พิมพ์มาเป็นภาษาอื่น ใช้บุคลิกผู้หญิงสม่ำเสมอทุกคำตอบ (สรรพนามแทนตัวเอง "ดิฉัน" ถ้าต้องใช้ และคำลงท้าย "ค่ะ"/"คะ" เท่านั้น) **ห้ามใช้ "ผม"/"ครับ" เด็ดขาดไม่ว่ากรณีใด**`;

  const dynamic = `วันนี้คือวันที่ ${today}${flowNote}`;
  return { base, dynamic };
}

const PENDING_TRANSACTION_EXPIRY_MS = 30 * 60 * 1000;

async function loadLineUser(lineUserId: string): Promise<LineUserInfo | null> {
  // Prefer the imported roster keyed by this LINE account's own userId —
  // that's LINE's account identity, so it can't be spoofed by typing
  // someone else's name/number. Covers members whose LINE is already
  // linked in the roster; they never get asked for their info at all.
  const roster = await prisma.memberRoster.findFirst({
    where: { lineUserId },
    select: { memberName: true, memberNumber: true },
  });
  if (roster) {
    return {
      fullName: roster.memberName,
      memberNumber: roster.memberNumber,
      verified: true,
    };
  }

  const user = await prisma.lineUser.findUnique({
    where: { id: lineUserId },
    select: { fullName: true, memberNumber: true },
  });
  if (!user) return null;
  return {
    fullName: user.fullName,
    memberNumber: user.memberNumber,
    verified: false,
  };
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

type PendingServiceInfo = {
  documentType: string;
  requestType: string | null;
  department: string | null;
};

type ServiceRequirement = "purpose" | "member_info" | null;

// Purpose is asked before member info, matching the natural conversational
// order: the user has already shown a document, so "what's this for" comes
// first; member identity only matters once we know what to attach it to.
function computeServiceRequirement(
  lineUser: LineUserInfo | null,
  pendingService: PendingServiceInfo
): ServiceRequirement {
  if (!pendingService.requestType) return "purpose";
  if (!lineUser?.fullName || !lineUser?.memberNumber) return "member_info";
  return null;
}

async function loadPendingServiceRequest(
  lineUserId: string
): Promise<PendingServiceInfo | null> {
  const pending = await prisma.pendingServiceRequest.findUnique({
    where: { lineUserId },
  });
  if (!pending) return null;
  if (Date.now() - pending.createdAt.getTime() > PENDING_TRANSACTION_EXPIRY_MS) {
    await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
    return null;
  }
  return pending;
}

// Extracts a "อ.XXX" district token from a unit name like
// "บำนาญ บึงกาฬ อ.ปากคาด" — returns null if the unit name has no district
// (e.g. a school name, or "หน่วยงานกลาง").
function extractDistrict(unitName: string): string | null {
  const match = unitName.match(/อ\.[ก-๙A-Za-z]+/);
  return match ? match[0] : null;
}

// Picks where to forward: loan requests try the district-specific contact
// first (via the member roster imported from the cooperative's existing
// spreadsheet), falling back to LINE_FORWARD_LOAN_ID if the member's
// district isn't known or has no confirmed contact yet. Everything else
// goes to LINE_FORWARD_GENERAL_ID.
async function resolveForwardTarget(
  lineUserId: string,
  department: string | null
): Promise<string | null> {
  if (department === "สินเชื่อ") {
    const roster = await prisma.memberRoster.findFirst({ where: { lineUserId } });
    const district = roster?.unitName ? extractDistrict(roster.unitName) : null;
    if (district) {
      const contact = await prisma.loanDistrictContact.findUnique({ where: { district } });
      if (contact) return contact.lineUserId;
    }
    return process.env.LINE_FORWARD_LOAN_ID ?? null;
  }
  return process.env.LINE_FORWARD_GENERAL_ID ?? null;
}

// Pushes the collected request to the resolved target and clears the
// pending record. If forwarding isn't configured or fails, the user is
// told honestly instead of being falsely reassured that staff were
// notified.
async function forwardServiceRequest(
  lineUserId: string,
  pendingService: PendingServiceInfo,
  lineUser: LineUserInfo
): Promise<string> {
  const targetId = await resolveForwardTarget(lineUserId, pendingService.department);
  if (!targetId) {
    await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
    console.warn(
      "[financeAgent] no forward target configured — service request not forwarded:",
      JSON.stringify(pendingService)
    );
    return "Error: forwarding isn't configured on this system. Apologize to the user and tell them to contact the cooperative office directly instead — do not claim the request was forwarded.";
  }

  const verifyMark = lineUser.verified
    ? "✅ ยืนยันตัวตนจากทะเบียน"
    : "⚠️ ยังไม่ยืนยัน (เลขสมาชิกไม่พบในทะเบียน — กรุณาตรวจสอบ)";
  const text = `📋 คำขอจากสมาชิก (ผ่าน LINE Bot)\nเอกสารที่ส่งมา: ${pendingService.documentType}\nแผนก: ${pendingService.department}\nคำขอ: ${pendingService.requestType}\nชื่อ-นามสกุล: ${lineUser.fullName}\nเลขสมาชิก: ${lineUser.memberNumber}\nสถานะ: ${verifyMark}`;

  try {
    await lineClient.pushMessage({ to: targetId, messages: [{ type: "text", text }] });
  } catch (err) {
    console.error("[financeAgent] forward service request push error:", err);
    await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
    return "Error: failed to forward the request. Apologize to the user and tell them to contact the cooperative office directly instead — do not claim the request was forwarded.";
  }

  await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
  return `Forwarded to the relevant department: "${pendingService.requestType}" for member ${lineUser.fullName} (${lineUser.memberNumber}). Confirm to the user, in Thai, that their request was sent and staff will contact them.`;
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
        memberVerified: lineUser.verified,
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

  // Verify the claimed member number against the imported roster.
  const roster = await prisma.memberRoster.findUnique({ where: { memberNumber } });

  // Block impersonation: this member number is already bound to a
  // different LINE account in the roster. Do not save or proceed.
  if (roster?.lineUserId && roster.lineUserId !== ctx.lineUserId) {
    return "Error: this member number is already linked to a different LINE account. Do not proceed. Tell the user, in Thai, that this member number is registered to another LINE account, and ask them to contact the cooperative office if they believe this is a mistake.";
  }

  const verified = roster !== null;

  // Link this LINE account to the roster row the first time a known member
  // identifies, so their future messages auto-identify without asking.
  if (roster && !roster.lineUserId) {
    await prisma.memberRoster
      .update({ where: { memberNumber }, data: { lineUserId: ctx.lineUserId } })
      .catch(() => {});
  }

  await prisma.lineUser.upsert({
    where: { id: ctx.lineUserId },
    create: { id: ctx.lineUserId, fullName, memberNumber },
    update: { fullName, memberNumber },
  });

  // Use the roster's canonical name when verified, so a small typo in what
  // the user typed doesn't end up on the logged record.
  const identity: LineUserInfo = {
    fullName: roster?.memberName ?? fullName,
    memberNumber,
    verified,
  };
  const unverifiedNote = verified
    ? ""
    : " (Note to you: this member number is NOT in the cooperative roster, so it could not be verified — proceed, but mention gently in Thai that staff will verify their membership.)";

  const pending = await loadPending(ctx.lineUserId);
  if (pending) {
    const next = computeNextRequirement(identity, pending);
    if (next === null) {
      const result = await finalizeTransaction(ctx.lineUserId, pending, identity);
      return result + unverifiedNote;
    }
    return requirementMessage(next) + unverifiedNote;
  }

  const pendingService = await loadPendingServiceRequest(ctx.lineUserId);
  if (pendingService) {
    const next = computeServiceRequirement(identity, pendingService);
    if (next === null) {
      const result = await forwardServiceRequest(ctx.lineUserId, pendingService, identity);
      return result + unverifiedNote;
    }
    // next can only be "purpose" here (member info just got filled in) —
    // ask for it since forwarding still needs it.
    return (
      "Still missing: what request/service the supporting document is for. Ask the user next, in Thai." +
      unverifiedNote
    );
  }

  return `Member info saved (${fullName}, ${memberNumber}). No transaction is currently in progress — just confirm to the user that their info was saved.${unverifiedNote}`;
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

type FlagSupportingDocumentInput = {
  documentType?: unknown;
};

async function flagSupportingDocument(
  input: FlagSupportingDocumentInput,
  ctx: ToolContext
): Promise<string> {
  const documentType =
    typeof input.documentType === "string" &&
    DOCUMENT_TYPES.includes(input.documentType as (typeof DOCUMENT_TYPES)[number])
      ? input.documentType
      : null;
  if (!documentType) {
    return `Error: documentType must be one of ${DOCUMENT_TYPES.join(", ")}.`;
  }

  await prisma.pendingServiceRequest.upsert({
    where: { lineUserId: ctx.lineUserId },
    create: { lineUserId: ctx.lineUserId, documentType },
    update: { documentType, requestType: null, department: null, createdAt: new Date() },
  });

  return `Noted a ${documentType} document. Ask the user, politely and in Thai, what request/service this document is for. Do not decline or log anything yet.`;
}

type SubmitServicePurposeInput = {
  purpose?: unknown;
  department?: unknown;
};

async function submitServicePurpose(
  input: SubmitServicePurposeInput,
  ctx: ToolContext
): Promise<string> {
  const purpose = typeof input.purpose === "string" ? input.purpose.trim() : "";
  if (!purpose) {
    return "Error: purpose must be a non-empty string.";
  }
  const department =
    input.department === "สินเชื่อ" || input.department === "อื่นๆ" ? input.department : null;
  if (!department) {
    return `Error: department must be one of สินเชื่อ, อื่นๆ.`;
  }

  const pendingService = await loadPendingServiceRequest(ctx.lineUserId);
  if (!pendingService) {
    return "Error: no in-progress supporting-document flow to attach this purpose to.";
  }

  const updated = await prisma.pendingServiceRequest.update({
    where: { lineUserId: ctx.lineUserId },
    data: { requestType: purpose, department, createdAt: new Date() },
  });

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeServiceRequirement(lineUser, updated);
  if (next === "member_info") {
    return "Still missing: member full name and member number, needed to forward this request. Ask the user for their ชื่อ-นามสกุล and เลขสมาชิก next, in Thai.";
  }
  return await forwardServiceRequest(ctx.lineUserId, updated, lineUser as LineUserInfo);
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
    if (name === "flag_supporting_document") {
      return await flagSupportingDocument(input as FlagSupportingDocumentInput, ctx);
    }
    if (name === "submit_service_purpose") {
      return await submitServicePurpose(input as SubmitServicePurposeInput, ctx);
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

export type FinanceAgentReply = { text: string; quickReplies: string[] };

export async function runFinanceAgent(
  userContent: Anthropic.MessageParam["content"],
  lineUserId: string,
  slipImageUrlPromise: Promise<string | null> = Promise.resolve(null),
  slipImageHash: string | null = null
): Promise<FinanceAgentReply> {
  const [lineUser, pending, pendingService] = await Promise.all([
    loadLineUser(lineUserId),
    loadPending(lineUserId),
    loadPendingServiceRequest(lineUserId),
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

  const { base, dynamic } = buildSystemPrompt(lineUser, pending, pendingService);
  // A cache breakpoint on the static base block caches everything before it
  // in the request (all tool definitions + this base system prompt), since
  // Anthropic's cacheable prefix runs tools → system → messages. The
  // dynamic block (date + flow note) sits after the breakpoint and is read
  // fresh each message. Cuts the per-message cost of the large, unchanging
  // instructions to a fraction after the first call.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: base, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ];
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
    const serviceNext =
      !pending && pendingService ? computeServiceRequirement(lineUser, pendingService) : null;
    if (turn === 0 && next === "member_info" && !hasImageContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_member_info" };
    } else if (turn === 0 && next === "category" && !hasImageContent(userContent)) {
      toolChoice = { type: "tool", name: "report_transaction" };
    } else if (turn === 0 && next === "loan_type" && !hasImageContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_loan_type" };
    } else if (turn === 0 && serviceNext === "purpose" && !hasImageContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_service_purpose" };
    } else if (turn === 0 && serviceNext === "member_info" && !hasImageContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_member_info" };
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
      // When a server tool (web_search/web_fetch) runs mid-turn, the model
      // often emits a text block *before* calling it (e.g. "กำลังค้นหาข้อมูล
      // ให้ค่ะ...") in addition to the real answer *after* the tool result.
      // The first text block was being sent to the user as the reply —
      // always a filler acknowledgement, never the actual answer. Use the
      // last text block instead, which is the one written with the tool
      // result in hand.
      const textBlock = response.content.findLast(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      const text = textBlock?.text.trim();
      // Server tools resolve within this same response (server_tool_use +
      // a *_tool_result block) rather than as a client tool_use block, so
      // they never show up in toolUseBlocks above. Log what ran and what
      // came back so a reply that wrongly claims "no info available" (or,
      // as above, sends only a pre-tool-call filler line) can be diagnosed
      // from Vercel logs instead of guessing.
      const serverToolResults = response.content.filter((b) =>
        b.type === "web_fetch_tool_result" || b.type === "web_search_tool_result"
      );
      console.log(
        `[financeAgent] no client tool called on turn ${turn}`,
        JSON.stringify({
          contentTypes: response.content.map((b) => b.type),
          textBlockCount: response.content.filter((b) => b.type === "text").length,
          serverToolResults: serverToolResults.map((b) => JSON.stringify(b).slice(0, 500)),
        })
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
      return {
        text: text || "ขอโทษค่ะ ไม่สามารถตอบได้ในตอนนี้",
        quickReplies: await computeQuickReplies(lineUserId),
      };
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
  const finalText = finalResponse.content.findLast(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return {
    text: finalText?.text.trim() || "ขอโทษค่ะ ดำเนินการไม่สำเร็จ ลองใหม่อีกครั้งนะคะ",
    quickReplies: await computeQuickReplies(lineUserId),
  };
}
