// Part of a daily-page recording booked under another category.
//
// A unit that deducts a member's pay often sends the cooperative more than
// the deduction in one transfer — the member's monthly สสค rides along. 29457:
// ฿19,320 from Udon Thani PES against ยอดแจ้งหัก ฿18,900; the ฿420 over is
// สสค. Recorded whole as the deduction, the ธุรกรรม tab says ฿19,320 of
// ชำระเก็บไม่ได้รายเดือน and no สสค at all. Setting the ฿420 aside leaves the
// recording at ฿18,900 and files ฿420 as สสค for the same member — two
// transactions that still add up to the one bank line.

import { SET_ASIDE_CATEGORIES } from "./transferSetAside";

const round2 = (n: number) => Math.round(n * 100) / 100;

// What a recording carries beyond what the round asked payroll to take, or 0.
export function recordingExcess(amount: number, expectedAmount: number | null | undefined): number {
  if (expectedAmount === null || expectedAmount === undefined || expectedAmount <= 0) return 0;
  const over = round2(amount - expectedAmount);
  return over > 0.005 ? over : 0;
}

// Why this part cannot be set aside. Null when it can.
export function recordingAsideProblem(
  recordingAmount: number,
  amount: number,
  category: string
): string | null {
  if (!(SET_ASIDE_CATEGORIES as readonly string[]).includes(category)) {
    return "เลือกประเภทที่จะบันทึกส่วนที่ตัดออก";
  }
  if (!Number.isFinite(amount) || amount <= 0) return "ยอดที่ตัดออกต้องมากกว่า 0";
  if (round2(amount) >= round2(recordingAmount)) {
    return "ยอดที่ตัดออกต้องน้อยกว่ายอดที่บันทึกไว้ — ถ้าทั้งก้อนเป็นประเภทอื่น ให้ลบรายการแล้วบันทึกใหม่";
  }
  return null;
}
