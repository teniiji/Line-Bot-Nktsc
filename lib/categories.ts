// What a member's payment can be for. This is the list the bot works from:
// each entry routes to a department (lib/categoryDepartments.ts), so a
// transaction filed under one of these reaches somebody.
export const CATEGORIES = [
  "ซื้อหุ้น",
  "ชำระหนี้",
  "ฝากเงิน",
  "ชำระเก็บไม่ได้รายเดือน",
  "ชำระประกัน",
  "ชำระฌาปนกิจ",
  "สสค",
  "สสอค",
  "สสชสอ",
  "สสสก",
  "สสสท",
] as const;

export type Category = (typeof CATEGORIES)[number];

// The way out, for money that is none of the eleven.
//
// The list above is what the cooperative collects, and it is nearly always
// enough — but "nearly" is doing work there, and until now the gap had no
// floor: a payment nobody could categorise could not be filed at all, so it
// stayed unrecorded while everyone waited for the list to grow. An
// unrecorded payment is worse than a roughly-labelled one.
//
// Offered to staff only. The bot keeps the eleven and goes on asking a
// member which one they mean, because a member given อื่นๆ will reach for it
// and the answer that routes the payment to a department would be lost. A
// person at the desk choosing it has already decided none of the eleven fit.
export const OTHER_CATEGORY = "อื่นๆ";

// Everything a person at the dashboard may file. Kept apart from CATEGORIES
// rather than folded into it so the bot's list cannot pick up อื่นๆ by
// accident — every enum it offers is built from CATEGORIES.
export const STAFF_CATEGORIES = [...CATEGORIES, OTHER_CATEGORY] as const;

export type StaffCategory = (typeof STAFF_CATEGORIES)[number];

export function isStaffCategory(value: string): boolean {
  return (STAFF_CATEGORIES as readonly string[]).includes(value);
}

// อื่นๆ on its own says nothing. Whoever chose it knows what the payment was
// for, and the whole point of the escape hatch is that the answer is written
// down at the moment it is known rather than reconstructed months later from
// an amount and a date.
export function categoryNeedsDetail(category: string): boolean {
  return category === OTHER_CATEGORY;
}

// Why this category and detail cannot be filed. Null when they can. Shared by
// the manual entry form, the edit form and the statement-line recorder so the
// three cannot drift on what "อื่นๆ" requires.
export function staffCategoryProblem(category: string, detail: string): string | null {
  if (!isStaffCategory(category)) return "หมวดหมู่ไม่ถูกต้อง";
  if (categoryNeedsDetail(category) && !detail.trim()) {
    return 'เลือก "อื่นๆ" แล้วต้องระบุด้วยว่าเป็นรายการอะไร';
  }
  return null;
}

export const CATEGORY_COLORS: Record<StaffCategory, string> = {
  "ซื้อหุ้น": "#14b8a6",
  "ชำระหนี้": "#f43f5e",
  "ฝากเงิน": "#0ea5e9",
  "ชำระเก็บไม่ได้รายเดือน": "#eab308",
  "ชำระประกัน": "#22c55e",
  "ชำระฌาปนกิจ": "#6b7280",
  "สสค": "#ec4899",
  "สสอค": "#a855f7",
  "สสชสอ": "#3b82f6",
  "สสสก": "#f97316",
  "สสสท": "#ef4444",
  // Grey on purpose: a slice the chart cannot name should not look like one
  // of the eleven the cooperative actually tracks.
  [OTHER_CATEGORY]: "#94a3b8",
};
