import { CATEGORIES, Category } from "./categories";

// Which department gets notified when a member logs a transaction in each
// category — every category must map to something so a newly-added
// CATEGORIES entry can't silently go unrouted (see the exhaustiveness test
// in tests/categoryDepartments.test.ts). "ชำระเก็บไม่ได้รายเดือน" resolves
// through the same per-member loan-officer routing as "สินเชื่อ" service
// requests (see resolveForwardTargets in lib/financeAgent.ts); every other
// category broadcasts to whichever officers are registered for that
// department in DepartmentContact.
export const CATEGORY_DEPARTMENTS: Record<Category, string> = {
  "ซื้อหุ้น": "สารสนเทศ",
  "ชำระหนี้": "สารสนเทศ",
  "ฝากเงิน": "เงินฝาก",
  "ชำระเก็บไม่ได้รายเดือน": "สินเชื่อ",
  "ชำระประกัน": "สวัสดิการ",
  "ชำระฌาปนกิจ": "ฌาปนกิจ",
  "สสค": "ฌาปนกิจ",
  "สสอค": "สวัสดิการ",
  "สสชสอ": "สวัสดิการ",
  "สสสก": "สวัสดิการ",
  "สสสท": "สวัสดิการ",
};

export function getCategoryDepartment(category: string): string | null {
  return (CATEGORIES as readonly string[]).includes(category)
    ? CATEGORY_DEPARTMENTS[category as Category]
    : null;
}
