// Cutting part of one round transfer out of the round ("ตัดยอดออก").
//
// A member's monthly transfer often carries more than the deduction: 29000
// sends ฿9,706 every month, ฿390 of it their สสค contribution. The round
// could only leave out a whole transfer (the "ไม่เกี่ยวกับรอบนี้ — …"
// dropdown), so the ฿390 went on counting as a deduction payment. This cuts
// the part out into a row of its own, left out of the round under what it
// was for, and files it as that member's payment in that category.

// What a part cut out can be. The deduction itself is not one — that is what
// the round is already counting.
export const SET_ASIDE_CATEGORIES = [
  "สสค",
  "สสอค",
  "สสชสอ",
  "สสสก",
  "สสสท",
  "ชำระฌาปนกิจ",
  "ชำระประกัน",
  "ซื้อหุ้น",
  "ชำระหนี้",
  "ฝากเงิน",
] as const;

// The row holding the cut-out part is named after the row it came from, so
// the two can be found together and put back together.
export const SET_ASIDE_MARKER = "::aside:";

export const isSetAsidePiece = (fingerprint: string) => fingerprint.includes(SET_ASIDE_MARKER);

export const parentFingerprintOf = (fingerprint: string) =>
  fingerprint.slice(0, fingerprint.indexOf(SET_ASIDE_MARKER));

const EPSILON = 0.005;

// Why this cannot be cut out. Null when it can. `available` is what the row
// still counts in its round — its amount less anything already paying a
// carried debt — so a cut can never leave the row counting less than nothing.
export function setAsideProblem(available: number, amount: number, category: string): string | null {
  if (!(SET_ASIDE_CATEGORIES as readonly string[]).includes(category)) {
    return "เลือกว่ายอดที่ตัดออกเป็นเงินอะไร";
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return "จำนวนเงินที่ตัดออกต้องมากกว่า 0";
  }
  if (amount > available + EPSILON) {
    return `ตัดออกได้ไม่เกินยอดที่รายการนี้ยังนับอยู่ (${available.toFixed(2)} บาท)`;
  }
  return null;
}
