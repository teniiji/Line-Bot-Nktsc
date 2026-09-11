import { describe, expect, it } from "vitest";
import {
  serviceRequestMessages,
  serviceRequestText,
  type ServiceRequestFacts,
} from "../lib/serviceRequestMessage";
import { NO_DOCUMENT } from "../lib/documentTypes";

const facts = (over: Partial<ServiceRequestFacts> = {}): ServiceRequestFacts => ({
  documentType: "สลิปเงินเดือน",
  department: "สินเชื่อ",
  requestType: "ขอกู้เงินสามัญ",
  memberFullName: "นางสาวธัญญริญญ์ ใจดี",
  memberNumber: "31538",
  phone: "0922565244",
  memberVerified: true,
  ...over,
});

describe("serviceRequestText", () => {
  it("gives the officer everything needed to ring the member back", () => {
    const text = serviceRequestText(facts());
    for (const piece of [
      "สลิปเงินเดือน",
      "สินเชื่อ",
      "ขอกู้เงินสามัญ",
      "นางสาวธัญญริญญ์ ใจดี",
      "31538",
      "0922565244",
    ]) {
      expect(text, piece).toContain(piece);
    }
  });

  it("marks a member the roster has never confirmed", () => {
    // The officer has to know whether the number was checked or typed.
    expect(serviceRequestText(facts())).toContain("✅ ยืนยันตัวตนจากทะเบียน");
    expect(serviceRequestText(facts({ memberVerified: false }))).toContain("⚠️ ยังไม่ยืนยัน");
  });

  it("says nothing about a document when none was sent", () => {
    const text = serviceRequestText(facts({ documentType: NO_DOCUMENT }));
    expect(text).not.toContain("เอกสารที่ส่งมา");
    expect(text).not.toContain(NO_DOCUMENT);
  });

  it("writes a dash where the member gave no telephone number", () => {
    expect(serviceRequestText(facts({ phone: null }))).toContain("เบอร์โทรติดต่อกลับ: -");
  });

  it("says on its face that a resend is one request sent again", () => {
    // An officer reading the same request twice should not have to work out
    // whether the member asked twice.
    const text = serviceRequestText(facts(), new Date("2026-09-04T03:23:00.000Z"));
    expect(text).toContain("🔁 ส่งซ้ำ");
    expect(text).toContain("คำขอเดิมเมื่อ");
  });

  it("dates the original in Thai time, not the server's", () => {
    // 03:23Z is 10:23 in the morning in Nong Khai, which is when she sent it.
    const text = serviceRequestText(facts(), new Date("2026-09-04T03:23:00.000Z"));
    expect(text).toContain("10:23");
  });

  it("leaves an ordinary first send unmarked", () => {
    expect(serviceRequestText(facts())).toContain("📋 คำขอจากสมาชิก");
    expect(serviceRequestText(facts())).not.toContain("🔁");
  });
});

describe("serviceRequestMessages", () => {
  it("sends a photo as a photo, beside the text", () => {
    const messages = serviceRequestMessages(facts(), "https://example.com/slip.jpg", false);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      type: "image",
      originalContentUrl: "https://example.com/slip.jpg",
    });
  });

  it("sends a PDF as a link, because LINE cannot push one as an image", () => {
    const messages = serviceRequestMessages(facts(), "https://example.com/doc.pdf", true);
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages)).toContain("https://example.com/doc.pdf");
    expect(JSON.stringify(messages)).toContain("📎");
  });

  it("sends the text alone when the document was never backed up", () => {
    // No BLOB_READ_WRITE_TOKEN configured, or the upload failed — the request
    // still has to reach the officer.
    const messages = serviceRequestMessages(facts(), null, false);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "text" });
  });

  it("carries the resend mark into the message that is actually sent", () => {
    const messages = serviceRequestMessages(
      facts(),
      "https://example.com/doc.pdf",
      true,
      new Date("2026-09-04T03:23:00.000Z")
    );
    expect(JSON.stringify(messages)).toContain("ส่งซ้ำ");
  });
});
