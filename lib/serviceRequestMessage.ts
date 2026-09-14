// What the officer receives when a member's request is handed to staff.
//
// Written once here, rather than inside the forwarding path, because the same
// message has to be sendable a second time: a forward that failed — a stale
// LINE id, an officer who has not added the bot, a department with nobody
// assigned yet — leaves a member's request sitting in the dashboard with
// nobody told about it, and the fix is to send it again once the cause is
// dealt with. The second send is built from what was logged rather than from
// the conversation, which by then is long gone.
//
// A resend says so on its face. An officer reading the same request twice
// should be able to tell at a glance that it is one request sent again, not a
// member asking twice.

import type { messagingApi } from "@line/bot-sdk";
import { NO_DOCUMENT } from "./documentTypes";
import { cooperativeDateTime } from "./cooperativeClock";

// Everything the message is built from — held on PendingServiceRequest while
// the conversation is live, and on ServiceRequestLog afterwards.
export interface ServiceRequestFacts {
  documentType: string;
  department: string | null;
  requestType: string | null;
  memberFullName: string | null;
  memberNumber: string | null;
  phone: string | null;
  memberVerified: boolean;
}

export function serviceRequestText(
  facts: ServiceRequestFacts,
  // Set when this is the second (or later) attempt: the date the member
  // actually made the request, so nobody reads a week-old request as today's.
  resentFrom: Date | null = null
): string {
  const verifyMark = facts.memberVerified
    ? "✅ ยืนยันตัวตนจากทะเบียน"
    : "⚠️ ยังไม่ยืนยัน (เลขสมาชิกไม่พบในทะเบียน — กรุณาตรวจสอบ)";
  const documentLine =
    facts.documentType === NO_DOCUMENT ? "" : `เอกสารที่ส่งมา: ${facts.documentType}\n`;
  const header = resentFrom
    ? `🔁 ส่งซ้ำคำขอจากสมาชิก (เจ้าหน้าที่กดส่งใหม่ — คำขอเดิมเมื่อ ${cooperativeDateTime(
        resentFrom
      )})`
    : "📋 คำขอจากสมาชิก (ผ่าน LINE Bot)";

  return (
    `${header}\n` +
    documentLine +
    `แผนก: ${facts.department}\n` +
    `คำขอ: ${facts.requestType}\n` +
    `ชื่อ-นามสกุล: ${facts.memberFullName}\n` +
    `เลขสมาชิก: ${facts.memberNumber}\n` +
    `เบอร์โทรติดต่อกลับ: ${facts.phone ?? "-"}\n` +
    `สถานะ: ${verifyMark}`
  );
}

/**
 * The message (or two) as LINE takes them.
 *
 * imageUrl is the best-effort Blob backup of the document the member sent
 * (null if BLOB_READ_WRITE_TOKEN isn't configured). LINE's Messaging API can
 * only push a real photo as an "image" message — it fetches and thumbnails
 * the URL — so a PDF goes as a plain text link instead.
 */
export function serviceRequestMessages(
  facts: ServiceRequestFacts,
  imageUrl: string | null,
  imageIsPdf: boolean,
  resentFrom: Date | null = null
): messagingApi.Message[] {
  const text = serviceRequestText(facts, resentFrom);
  if (!imageUrl) return [{ type: "text", text }];
  if (imageIsPdf) {
    return [{ type: "text", text: `${text}\n📎 ไฟล์เอกสาร (PDF): ${imageUrl}` }];
  }
  return [
    { type: "text", text },
    { type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl },
  ];
}
