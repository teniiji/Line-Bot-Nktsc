export const DOCUMENT_TYPES = [
  "สลิปเงินเดือน",
  "สำเนาบัตรประชาชน",
  "สำเนาทะเบียนบ้าน",
  "ทะเบียนสมรส",
  "เอกสารประกอบอื่นๆ",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
