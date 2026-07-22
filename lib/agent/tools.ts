// Claude tool-use schema for the finance agent. Split out of
// lib/financeAgent.ts — the definitions here and the handlers in
// ./handlers.ts must stay in sync (executeTool dispatches by name).
import type Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES } from "../categories";
import { LOAN_TYPES } from "../loanTypes";
import { DOCUMENT_TYPES } from "../documentTypes";
import { DEPARTMENTS } from "../departments";

export const tools: Anthropic.Tool[] = [
  {
    name: "report_transaction",
    description:
      "Call this whenever the user describes or shows (via a slip image or PDF) a completed cooperative transaction: a share purchase (ซื้อหุ้น), a loan repayment (ชำระหนี้), a savings deposit (ฝากเงิน), or one of the other cooperative payment categories. Call it every time, even if you don't yet have every detail — the system tracks what's still missing (member identity, transfer slip, category, loan type) and tells you exactly what to ask for next. Also call this (with just the category filled in) when the user answers a question about which category a pending transaction is for. Never log a transaction any other way.",
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
            "Transaction amount in Thai baht, if known from the text or a slip image/PDF. Always positive. Omit only if truly not yet stated anywhere.",
        },
        description: {
          type: "string",
          description:
            "Short free-text note, e.g. bill name or purpose. Only include what the user actually stated or what's explicitly written on a slip/receipt image or PDF — never invent one. Omit this field entirely if no purpose is stated.",
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
        senderName: {
          type: "string",
          description:
            "The name shown in the slip's \"จาก\" (sender/from) field — the person or account the money is moving FROM — if a slip image or PDF is present and clearly shows one. Copy exactly as printed, including any title (นาย/นาง/นางสาว). Omit if not visible, not applicable, or this message has no slip attached. Never guess.",
        },
        recipientName: {
          type: "string",
          description:
            "The name shown in the slip's \"ไปยัง\" (recipient/to) field — the account the money is moving TO — if a slip image or PDF is present and clearly shows one. Copy exactly as printed, including any title. The system verifies it is the cooperative's account and rejects the transaction itself if not, so always report what you actually see. Omit if not visible, not applicable, or this message has no slip attached. Never guess.",
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
    name: "submit_contact_phone",
    description:
      "Call when the user provides a callback phone number for a supporting-document service request that's about to be forwarded to cooperative staff — either proactively, or in answer to being asked for it. Only relevant while such a request is pending; never call this for cooperative transaction logging (ซื้อหุ้น, ชำระหนี้, ฝากเงิน, etc.).",
    input_schema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "The callback phone number, copied as stated.",
        },
      },
      required: ["phone"],
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
    name: "submit_deposit_account",
    description:
      "Call when the user specifies which cooperative savings account number (เลขที่บัญชี) an in-progress ฝากเงิน (deposit) transaction should go into — either proactively, or in answer to being asked for it.",
    input_schema: {
      type: "object",
      properties: {
        accountNumber: {
          type: "string",
          description: "The account number, copied exactly as stated.",
        },
      },
      required: ["accountNumber"],
    },
  },
  {
    name: "confirm_transaction_sender",
    description:
      "Call when the user answers whether an in-progress transaction is genuinely their own — asked only when the slip's sender name didn't match their registered name. confirmed: true if they say it is their transaction (e.g. themselves, or a family member/spouse transferring on their behalf), false if they say it isn't (e.g. it's a mistake or someone else's slip).",
    input_schema: {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          description: "Whether the user confirmed this is genuinely their own transaction.",
        },
      },
      required: ["confirmed"],
    },
  },
  {
    name: "decline_unreadable_image",
    description:
      "Use only for an image or PDF that genuinely isn't a bank/wallet transaction slip and isn't one of the known supporting-document types either (a random unrelated photo, or a slip whose own text explicitly says the transaction failed/is pending/was cancelled). For a payslip, ID card copy, house registration copy, or marriage certificate, use flag_supporting_document instead — those aren't declined, they're routed to ask what the user needs. Call this instead of replying with plain text — your reply text afterward explains why to the user.",
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
      "Call when the user sends an image or PDF that is a supporting document — a payslip (สลิปเงินเดือน, which includes full-page government payroll/deduction ledgers like \"บัญชีถือจ่ายเงินเดือนข้าราชการ\", not just small bank-style slips), ID card copy (สำเนาบัตรประชาชน), house registration copy (สำเนาทะเบียนบ้าน), marriage certificate (ทะเบียนสมรส), or any other official/formal document that clearly isn't a transfer slip (documentType: เอกสารประกอบอื่นๆ) — rather than a bank/wallet transfer slip. These are usually submitted for some other cooperative service (e.g. a loan application) that this bot doesn't process directly; it asks what the request is for and forwards it to the right department. Never decline a formal/official document just because it isn't a transfer slip — that's exactly when this tool applies. Only use decline_unreadable_image for images or PDFs genuinely unrelated to the cooperative or incomplete transfer slips.",
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
          enum: [...DEPARTMENTS],
          description:
            "Which team should handle this. IMPORTANT: if the user's own wording names one of the department options directly (e.g. they say 'ส่งสารสนเทศ', 'ติดต่อฝ่ายบัญชี', 'ฝ่ายสวัสดิการ'), always use that named department — never reinterpret it into a different one based on the topic guide below, and never default to 'บริหารสำนักงาน/ธุรการ' when a specific department was actually named. Only fall back to the topic-based guide when no department was named explicitly: 'สินเชื่อ' for anything loan-related (กู้เงิน, สินเชื่อ, any loan type); 'เงินฝาก' for savings/deposit accounts; 'สารสนเทศ' for IT/app/system issues; 'สวัสดิการ' for welfare benefits (ทุนการศึกษา, ส.ส.ค., เงินปันผล); 'นิติการ' for legal matters; 'บัญชี' for accounting; 'ฌาปนกิจ' for the funeral fund (ฌกส/ฌาปนกิจสงเคราะห์); 'บริหารสำนักงาน/ธุรการ' for general office/administrative service with no better fit; 'อื่นๆ' only when truly none of the above fit.",
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
  {
    name: "submit_lookup_info",
    description:
      "Call when the member asks to find out their own เลขสมาชิก (member number) — e.g. they forgot it, or ask 'เลขสมาชิกของฉันคืออะไร'/'ลืมเลขสมาชิก'. This requires verifying their identity first: full name, 13-digit เลขประจำตัวประชาชน (national ID number), and registered phone number. Call this every time with whatever piece(s) of that the member has just given, even if you don't have all three yet — the system tracks what's still missing and, once all three are present, checks them against the member roster itself and tells you the result. NEVER state a member number to the user without this verification completing successfully first, no matter how confident the member sounds about their own identity, and never guess or invent any of the three fields.",
    input_schema: {
      type: "object",
      properties: {
        fullName: {
          type: "string",
          description: "The member's full name (ชื่อ-นามสกุล), copied as stated.",
        },
        nationalId: {
          type: "string",
          description:
            "The member's 13-digit เลขประจำตัวประชาชน (national ID number), copied as stated — dashes/spaces are fine, no need to reformat.",
        },
        phone: {
          type: "string",
          description: "The member's registered phone number, copied as stated.",
        },
      },
    },
  },
  // web_search + web_fetch (restricted to the cooperative's own domain via
  // allowed_domains) were removed after a live test surfaced a gambling-spam
  // link preview in a bot reply — the cooperative's WordPress site appears
  // to have injected/compromised spam content indexed under its own domain,
  // which the domain allowlist cannot filter out since it's scoped to the
  // whole domain, not specific known-good pages. Answering only from the
  // static reference data below (member-verified content we control
  // directly) is safer than live-browsing a site we can't currently vouch
  // for. Re-add server tools only after the site is confirmed clean.
];

