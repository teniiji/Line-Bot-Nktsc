export const DOCUMENT_TYPES = [
  "สลิปเงินเดือน",
  "สำเนาบัตรประชาชน",
  "สำเนาทะเบียนบ้าน",
  "ทะเบียนสมรส",
  "เอกสารประกอบอื่นๆ",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// PendingServiceRequest.documentType for a request started from plain text
// (e.g. request_staff_help — a forgotten password report) rather than an
// attached document. Not part of DOCUMENT_TYPES since it's never a choice
// offered to flag_supporting_document's tool schema.
export const NO_DOCUMENT = "ไม่มีเอกสารแนบ";
