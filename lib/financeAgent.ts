import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { anthropic } from "./anthropicClient";
import { prisma } from "./prisma";
import { CATEGORIES } from "./categories";
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
    name: "log_transaction",
    description:
      "Record a completed money transaction the user described: a purchase/expense, a bill payment, a loan taken out, a debt repayment, a stock/investment purchase, or a bank deposit/savings. Call this only when the user is reporting something that already happened and gave a clear amount.",
    input_schema: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Transaction amount in Thai baht. Always positive.",
        },
        category: {
          type: "string",
          enum: [...CATEGORIES],
          description: "Best-fitting category for this transaction.",
        },
        description: {
          type: "string",
          description:
            "Short free-text note, e.g. merchant or purpose. Only include what the user actually stated or what's explicitly written on a slip/receipt image — never invent one. Omit this field entirely if no purpose is stated.",
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
      required: ["amount", "category"],
    },
  },
  {
    name: "hold_transaction_for_purpose",
    description:
      "Use only when a slip/message clearly shows a completed transfer amount but states no purpose, memo, bill name, or merchant anywhere — nothing to log a real description from (e.g. a plain person-to-person transfer with just a recipient name). Temporarily holds the amount and date so the next message from this user can supply the purpose. Do not call log_transaction in the same turn as this — after calling this, your reply text must ask the user what the transaction was for.",
    input_schema: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Transaction amount in Thai baht. Always positive.",
        },
        date: {
          type: "string",
          description:
            "ISO 8601 date (YYYY-MM-DD) the transaction happened on. Omit to use today.",
        },
        referenceNumber: {
          type: "string",
          description:
            "The bank/wallet transaction reference number (รหัสอ้างอิง) shown on the slip, if visible. Copy it exactly as printed. Omit if not shown.",
        },
      },
      required: ["amount"],
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
      "Use only when the user explicitly asks to set or change their own nickname/display name for this bot (e.g. 'เปลี่ยนชื่อเรียกฉันเป็น...', 'ตั้งชื่อเล่นว่า...', 'เรียกฉันว่า...'). Never call this for any other reason — it does not log a transaction.",
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

type PendingTransactionInfo = {
  amount: number;
  date: Date;
  slipImageUrl: string | null;
  referenceNumber: string | null;
};

type ToolContext = { lineUserId: string; slipImageUrl: string | null };

function buildSystemPrompt(pending: PendingTransactionInfo | null): string {
  const today = new Date().toISOString().slice(0, 10);
  const pendingNote = pending
    ? `\n\nหมายเหตุระบบ (สำคัญ): ข้อความก่อนหน้านี้คุณได้เรียก hold_transaction_for_purpose ไว้แล้วสำหรับจำนวนเงิน ${formatAmount(
        pending.amount
      )} วันที่ ${pending.date
        .toISOString()
        .slice(
          0,
          10
        )}${
        pending.referenceNumber
          ? ` เลขอ้างอิง "${pending.referenceNumber}"`
          : ""
      } และถามผู้ใช้ไปว่าเป็นรายการอะไร ข้อความปัจจุบันของผู้ใช้คือคำตอบสำหรับจุดประสงค์ของรายการนั้น ให้เลือกหมวดหมู่ที่เหมาะสมจากคำตอบนี้ทันที (ใช้ Other ถ้าเดาไม่ได้จริงๆ) แล้วเรียก log_transaction ด้วย amount=${pending.amount}, date="${pending.date
        .toISOString()
        .slice(0, 10)}"${
        pending.referenceNumber
          ? `, referenceNumber="${pending.referenceNumber}"`
          : ""
      } ในข้อความนี้เลย ห้ามถามซ้ำอีกเด็ดขาด`
    : "";
  return `คุณคือผู้ช่วยด้านการเงินส่วนตัวที่ทำงานผ่าน LINE ให้กับแอปบันทึกรายจ่าย (expense tracker) วันนี้คือวันที่ ${today}

หมวดหมู่ที่ใช้ในระบบมีเฉพาะ: ${CATEGORIES.join(", ")}

ข้อจำกัดสำคัญที่ต้องรู้: แต่ละข้อความที่ผู้ใช้ส่งเข้ามาถูกประมวลผลแยกจากกันโดยสิ้นเชิง คุณ**ไม่มีความจำ**ข้อความหรือรูปก่อนหน้าเลย ดังนั้น**ห้ามถามคำถามกลับเพื่อขอข้อมูลเพิ่มเติมก่อนบันทึกเด็ดขาด** **ข้อยกเว้นเดียวที่อนุญาตให้ถามกลับได้คือ**: สลิปที่ไม่มีจุดประสงค์/หมายเหตุ/ชื่อบิล/ชื่อร้านระบุไว้เลยจริงๆ (รายละเอียดดูขั้นที่ 2 ในข้อ 4 ด้านล่าง) — กรณีนั้นให้เรียก hold_transaction_for_purpose แล้วถามได้ เพราะระบบจะจำยอดเงินไว้ชั่วคราวรอคำตอบในข้อความถัดไปของผู้ใช้คนเดียวกันโดยเฉพาะ **นอกเหนือจากกรณีนี้เพียงกรณีเดียว ห้ามถามกลับเด็ดขาดไม่ว่าเหตุผลใดก็ตาม** (เช่น ห้ามถามว่า "หมวดหมู่ไหน", ห้ามถามยืนยันทิศทางเงิน, ห้ามถามข้อมูลเพิ่มอื่นๆ) ทุกครั้งที่มีจำนวนเงินและหลักฐานว่าธุรกรรมเกิดขึ้นแล้ว (นอกเหนือจากข้อยกเว้นข้างต้น) ให้ตัดสินใจเลือกหมวดหมู่ที่ใกล้เคียงที่สุดเองจากสิ่งที่ผู้ใช้พิมพ์มาหรือข้อความในสลิปโดยตรง (ใช้ Other ถ้าเดาไม่ได้จริงๆ) แล้วเรียก log_transaction บันทึกให้เสร็จภายในข้อความเดียวเสมอ ไม่ต้องรอถามก่อน

หน้าที่ของคุณมี 5 อย่าง:
1. เมื่อผู้ใช้เล่าถึงธุรกรรมทางการเงินที่เกิดขึ้นแล้ว (ซื้อของ, จ่ายบิล, กู้เงิน, ชำระหนี้, ซื้อหุ้น/ลงทุน, ฝากเงิน) ให้เรียกใช้ log_transaction เพื่อบันทึกลงระบบทันที แล้วตอบยืนยันสั้นๆ เป็นภาษาไทย
2. เมื่อผู้ใช้ถามเกี่ยวกับประวัติการเงินของตัวเอง (เช่น "เดือนนี้จ่ายหนี้ไปเท่าไหร่") ให้เรียกใช้ get_transaction_summary แล้วสรุปคำตอบเป็นภาษาไทย
3. เมื่อผู้ใช้ถามคำถามความรู้ทั่วไปเกี่ยวกับการเงิน (เช่น อัตราดอกเบี้ย, วิธีลงทุน, การกู้ยืม) ที่ไม่เกี่ยวกับข้อมูลส่วนตัวของเขา ให้ตอบด้วยความรู้ทั่วไปโดยตรง ไม่ต้องเรียกเครื่องมือใดๆ และควรระบุว่าเป็นข้อมูลทั่วไป ไม่ใช่คำแนะนำทางการเงินจากผู้เชี่ยวชาญที่มีใบอนุญาต
4. เมื่อผู้ใช้ขอเปลี่ยน/ตั้งชื่อเล่นของตัวเอง (เช่น "เปลี่ยนชื่อเรียกฉันเป็น...", "ตั้งชื่อเล่นว่า...") ให้เรียก set_nickname ด้วยชื่อที่ผู้ใช้ระบุ แล้วตอบยืนยันสั้นๆ ห้ามเรียก tool นี้เพื่อเหตุผลอื่นนอกจากนี้เด็ดขาด
5. เมื่อผู้ใช้ส่งรูปสลิปการโอนเงิน/จ่ายบิล/ใบเสร็จมาให้ ทำตามขั้นตอนนี้ตามลำดับเสมอ:

ขั้นที่ 1 (สำคัญที่สุด — ตัดสินก่อนเรื่องอื่นทั้งหมด) ตัดสินใจว่าสลิปนี้"สำเร็จ"หรือไม่: แอปธนาคาร/กระเป๋าเงินดิจิทัลของไทยทุกเจ้า ไม่ว่าจะเป็นธนาคารใด หรือแอปอย่างเป๋าตังก์ (Paotang), ทรูมันนี่, LINE Pay ฯลฯ (ไม่ใช่แค่รายชื่อตัวอย่างเช่น K PLUS, SCB Easy, Krungthai NEXT, Bualuang mBanking, ttb touch, MyMo, Krungsri App) มีสลิปหน้าตาและถ้อยคำไม่เหมือนกัน **กฎเดียวที่ใช้ตัดสิน**: สแกนหาคำหรือวลีที่ลงท้ายด้วย "สำเร็จ" (เช่น "โอนเงินสำเร็จ", "จ่ายบิลสำเร็จ", "ชำระเงินสำเร็จ", "เติมเงินสำเร็จ", "รายการสำเร็จ" หรือความหมายใกล้เคียง) หรือเครื่องหมายถูก/checkmark สีเขียว **ถ้าเจออย่างใดอย่างหนึ่งในภาพ ให้ถือว่าสำเร็จเสมอทันที** ไม่ว่าธนาคารไหน ประเภทธุรกรรมอะไร หรือพื้นหลัง/ธีม/โลโก้/ภาพตกแต่งจะเป็นแบบใดก็ตาม — **ห้ามปฏิเสธการบันทึกด้วยเหตุผลว่า "ไม่เห็นคำยืนยัน" ถ้าจริงๆ แล้วมีคำว่า "สำเร็จ" หรือเครื่องหมายถูกอยู่ในภาพ** ปฏิเสธการบันทึกเฉพาะกรณีที่ข้อความในสลิปเองชัดเจนว่ายังไม่สำเร็จ/ถูกยกเลิก/รอดำเนินการ หรืออ่านจำนวนเงินไม่ออกจริงๆ เท่านั้น — กรณีปฏิเสธเหล่านี้ **ต้องเรียก decline_unreadable_image เสมอ ห้ามตอบเป็นข้อความเปล่าๆ โดยไม่เรียก tool ใดเลยเด็ดขาด** (รูปภาพทุกรูปที่ส่งมาต้องจบด้วยการเรียก tool ตัวใดตัวหนึ่งในสามตัวนี้เท่านั้น: log_transaction, hold_transaction_for_purpose, หรือ decline_unreadable_image) **แอปธนาคารไทยหลายเจ้านิยมใส่ภาพพื้นหลังตกแต่งสไตล์ต่างๆ ทับหน้าจอสลิปตัวเอง (เช่น ธีมกีฬา, ธีมเทศกาล, ธีมโปรโมชั่น, ลายการ์ตูน) ซึ่งเป็นแค่ "สกิน/ธีมกราฟิก" ของแอปที่ไม่เกี่ยวข้องกับตัวธุรกรรมเลย ห้ามตีความว่าพื้นหลังธีมกีฬา/เทศกาล/โปรโมชั่นเหล่านี้ทำให้สลิปกลายเป็น "ข่าว", "โปรโมชั่น", "ตั๋ว", หรือเนื้อหาที่ไม่ใช่ธุรกรรมจริงเด็ดขาด — ถ้าเห็นกล่องข้อความยืนยันการโอน/จ่ายเงิน (มีคำว่า "สำเร็จ" + เครื่องหมายถูก + จำนวนเงิน + เลขที่รายการ) ซ้อนทับอยู่บนพื้นหลังธีมใดๆ ก็ตาม ให้ถือเป็นธุรกรรมจริงเสมอ ไม่ว่าพื้นหลังจะเป็นภาพอะไร** ห้ามใช้ภาพพื้นหลังหรือโลโก้มาตัดสินว่าเป็นตั๋ว/ใบสมัครสมาชิก/ข่าว/เอกสารอื่นเด็ดขาด ให้ดูเฉพาะข้อความและตัวเลขที่เป็นเนื้อหาจริงเท่านั้น **ห้ามพยายามตัดสินว่าธุรกรรมเป็นเงินเข้าหรือเงินออก (รับเงินหรือจ่ายเงิน) จากช่อง "จาก"/"ไปยัง" หรือชื่อบัญชีเด็ดขาด เพราะคุณไม่มีทางรู้ได้จริงว่าชื่อไหนในสลิปคือตัวผู้ใช้เอง ให้ถือว่าทุกสลิปที่ผู้ใช้ส่งมาคือธุรกรรมที่เขาต้องการบันทึกเสมอ ไม่ว่าทิศทางเงินทางเทคนิคจะเป็นแบบใด ห้ามปฏิเสธหรือถามย้อนกลับด้วยเหตุผลเรื่องทิศทางเงินเข้า-ออกเด็ดขาด**

ขั้นที่ 2 (เมื่อยืนยันว่าสำเร็จแล้วเท่านั้น) ตัดสินใจว่ามีจุดประสงค์ระบุไว้ไหม: เลือกหมวดหมู่ตามบริบทที่เห็นในสลิปจริงๆ ถ้ามีระบุไว้ (เช่น ข้อความหมายเหตุการโอน, ชื่อบิลที่จ่าย) แล้วเรียก log_transaction บันทึกทันทีในข้อความเดียว **ถ้าสลิปไม่มีจุดประสงค์/หมายเหตุ/ชื่อบิล/ชื่อร้านระบุไว้เลยจริงๆ** (เช่น โอนเงินหาคนทั่วไปโดยไม่มีข้อความหมายเหตุใดๆ) **ให้เรียก hold_transaction_for_purpose แทน log_transaction แล้วถามผู้ใช้กลับสั้นๆ ว่าเป็นรายการอะไร** (กรณีนี้เท่านั้นที่อนุญาตให้ถามกลับได้)

ขั้นที่ 3 กฎการเขียน description: **ชื่อบุคคลหรือชื่อบัญชีของผู้รับโอน/ผู้ส่งเงิน (เช่น ข้อความในช่อง "ไปยัง"/"จาก") ไม่ใช่จุดประสงค์การโอน ห้ามนำมาใส่เป็น description และห้ามต่อเติม/เดาให้กลายเป็นชื่ออื่นที่ฟังดูสมเหตุสมผลกว่าเดิมเด็ดขาด (เช่น ห้ามเปลี่ยน "ไทยพลัส" ให้กลายเป็น "Thai Airways พลัส")** description ต้องคัดลอกเฉพาะข้อความหมายเหตุ/บันทึกการโอนที่เห็นในสลิปตามตัวอักษรเป๊ะๆ เท่านั้น ห้ามเดา ห้ามเติมคำ ห้ามขยายความแม้แต่คำเดียว ถ้าอ่านไม่ชัดหรือไม่มั่นใจว่าตัวอักษรคืออะไร ให้ปล่อย description ว่างไว้ดีกว่าเดา

ขั้นที่ 4 กันรายการซ้ำ: ถ้าสลิปมีเลขที่รายการ/รหัสอ้างอิง (เช่น "รหัสอ้างอิง", "เลขที่รายการ") ให้คัดลอกใส่ referenceNumber ตามตัวอักษรเป๊ะๆ ระบบจะเช็คให้อัตโนมัติว่าเคยบันทึกสลิปนี้ไปแล้วหรือยัง ถ้า log_transaction แจ้งกลับมาว่าเป็นรายการซ้ำ ให้บอกผู้ใช้ตรงๆ ว่าเคยบันทึกรายการนี้ไปแล้ว ไม่ต้องบันทึกซ้ำอีก

ตอบสั้น กระชับ เป็นกันเอง และเป็นภาษาไทยเสมอ เว้นแต่ผู้ใช้พิมพ์มาเป็นภาษาอื่น${pendingNote}`;
}

type LogTransactionInput = {
  amount?: unknown;
  category?: unknown;
  description?: unknown;
  date?: unknown;
  referenceNumber?: unknown;
};

async function logTransaction(
  input: LogTransactionInput,
  ctx: ToolContext
): Promise<string> {
  const { amount, category, description, date, referenceNumber } = input;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return "Error: amount must be a positive number.";
  }
  if (
    typeof category !== "string" ||
    !CATEGORIES.includes(category as (typeof CATEGORIES)[number])
  ) {
    return `Error: category must be one of ${CATEGORIES.join(", ")}.`;
  }
  const parsedDate = typeof date === "string" && date ? new Date(date) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    return "Error: invalid date.";
  }

  try {
    const expense = await prisma.expense.create({
      data: {
        amount,
        category,
        description: typeof description === "string" ? description : null,
        date: parsedDate,
        lineUserId: ctx.lineUserId,
        referenceNumber:
          typeof referenceNumber === "string" && referenceNumber
            ? referenceNumber
            : null,
        slipImageUrl: ctx.slipImageUrl,
      },
    });

    return `Logged: ${formatAmount(expense.amount)} (${expense.category}) on ${expense.date
      .toISOString()
      .slice(0, 10)}.`;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      (err.meta?.target as string[] | undefined)?.includes("referenceNumber")
    ) {
      return "Error: a transaction with this exact reference number was already recorded — this looks like a duplicate slip. Tell the user it was already logged and do not log it again.";
    }
    throw err;
  }
}

type HoldTransactionInput = {
  amount?: unknown;
  date?: unknown;
  referenceNumber?: unknown;
};

async function holdTransactionForPurpose(
  input: HoldTransactionInput,
  ctx: ToolContext
): Promise<string> {
  const { amount, date, referenceNumber } = input;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return "Error: amount must be a positive number.";
  }
  const parsedDate = typeof date === "string" && date ? new Date(date) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    return "Error: invalid date.";
  }
  const refNumber =
    typeof referenceNumber === "string" && referenceNumber ? referenceNumber : null;

  // A duplicate slip with no stated purpose would otherwise sail through
  // this hold-and-ask path unchecked, since the real duplicate guard only
  // runs inside log_transaction. Check it here too, against already-logged
  // expenses, so a resent purpose-less slip is caught immediately instead
  // of asking the user the same question twice.
  if (refNumber) {
    const existing = await prisma.expense.findUnique({
      where: { referenceNumber: refNumber },
    });
    if (existing) {
      return `Error: a transaction with this exact reference number was already recorded — this looks like a duplicate slip. Tell the user it was already logged and do not hold or log it again.`;
    }
  }

  await prisma.pendingTransaction.upsert({
    where: { lineUserId: ctx.lineUserId },
    create: {
      lineUserId: ctx.lineUserId,
      amount,
      date: parsedDate,
      slipImageUrl: ctx.slipImageUrl,
      referenceNumber: refNumber,
    },
    update: {
      amount,
      date: parsedDate,
      slipImageUrl: ctx.slipImageUrl,
      referenceNumber: refNumber,
      createdAt: new Date(),
    },
  });

  return `Held ${formatAmount(amount)} pending a purpose. Ask the user what this transaction was for — do not log it yet.`;
}

const PENDING_TRANSACTION_EXPIRY_MS = 15 * 60 * 1000;

async function claimPendingTransaction(
  lineUserId: string
): Promise<PendingTransactionInfo | null> {
  const pending = await prisma.pendingTransaction.findUnique({
    where: { lineUserId },
  });
  if (!pending) return null;

  // Claim it (delete) regardless of age, so a later unrelated message never
  // gets misread as answering a stale hold.
  await prisma.pendingTransaction.delete({ where: { lineUserId } });

  if (Date.now() - pending.createdAt.getTime() > PENDING_TRANSACTION_EXPIRY_MS) {
    return null;
  }
  return {
    amount: pending.amount,
    date: pending.date,
    slipImageUrl: pending.slipImageUrl,
    referenceNumber: pending.referenceNumber,
  };
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
    if (name === "log_transaction") {
      return await logTransaction(input as LogTransactionInput, ctx);
    }
    if (name === "hold_transaction_for_purpose") {
      return await holdTransactionForPurpose(
        input as HoldTransactionInput,
        ctx
      );
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
  slipImageUrlPromise: Promise<string | null> = Promise.resolve(null)
): Promise<string> {
  // Only a plain text reply can complete a pending hold — an incoming image
  // is always a new slip, never an answer to "what was this for?".
  const pending =
    typeof userContent === "string"
      ? await claimPendingTransaction(lineUserId)
      : null;

  // The caller kicks off the Blob upload before calling this function but
  // doesn't await it, so it runs concurrently with the first Claude API
  // round-trip below instead of blocking it. Only resolve it once a tool
  // call actually needs it (never for a pending-hold resume, which already
  // has its own stored slip URL).
  let resolvedSlipImageUrl: string | null | undefined;
  async function resolveSlipImageUrl(): Promise<string | null> {
    if (resolvedSlipImageUrl === undefined) {
      resolvedSlipImageUrl = pending?.slipImageUrl ?? (await slipImageUrlPromise);
    }
    return resolvedSlipImageUrl;
  }

  const system = buildSystemPrompt(pending);
  const model = hasImageContent(userContent) ? VISION_MODEL : TEXT_MODEL;
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userContent },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    // The model tends to respond with plain text instead of calling a tool
    // when it wants to ask something — even when explicitly instructed to
    // call hold_transaction_for_purpose first. Force a tool call on the
    // first turn for image messages so every slip results in one of
    // log_transaction / hold_transaction_for_purpose / decline_unreadable_image,
    // never a bare text reply with nothing persisted.
    //
    // Resuming a pending hold needs a *specific* forced tool, not just any
    // tool: forcing "any" still let the model pick hold_transaction_for_purpose
    // again with no amount (since that's the tool it just used), which fails
    // validation and comes back as a text-only "tell me the amount" reply on
    // the next turn — silently dropping the held transaction. The pendingNote
    // already tells the model the exact log_transaction call to make, so
    // force that tool specifically.
    let toolChoice: Anthropic.ToolChoice | undefined;
    if (turn === 0 && pending !== null) {
      toolChoice = { type: "tool", name: "log_transaction" };
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
