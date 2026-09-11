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

// What request_staff_help should write over a request that is already under
// way.
//
// It exists for a request that arrives as plain text with nothing attached —
// a forgotten password — and creates the PendingServiceRequest row itself. So
// its write set documentType to NO_DOCUMENT and cleared the image, on both
// halves of the upsert.
//
// On the update half that is destructive. A member sent a salary certificate,
// flag_supporting_document filed it against her request, and when she said
// what she wanted the model reached for request_staff_help rather than
// submit_service_purpose. The row was overwritten, and the request reached
// staff reading "ไม่มีเอกสารแนบ" — with her certificate sitting in Blob
// storage, attached to nothing, while the officer who picked it up had
// nothing to look at.
//
// A document the member sent is a fact about the request, and no later tool
// call is evidence that it stopped being one. So an attached document is left
// alone and only a request that genuinely has none is marked as having none.
export function staffHelpDocumentFields(
  existingDocumentType: string | null
): { documentType: string; imageUrl: null; imageIsPdf: boolean } | Record<string, never> {
  const holdsDocument = existingDocumentType !== null && existingDocumentType !== NO_DOCUMENT;
  return holdsDocument ? {} : { documentType: NO_DOCUMENT, imageUrl: null, imageIsPdf: false };
}
