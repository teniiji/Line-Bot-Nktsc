// Phase 3 of the enrollment register: what the monthly รายการหัก has to change
// because of it, what premium is still to collect, and who applied but then
// could not be deducted.
//
// The รายการหัก files are built outside this app, one per unit, so what this
// can do is say exactly which lines to add or take out — by unit, with the
// monthly fee — and remember which month each change was put in, so the next
// month's list holds only what is still outstanding.

export const DEDUCTION_PRODUCTS = ["sok", "scs", "sst", "ssk", "relative"] as const;
export type DeductionProduct = (typeof DEDUCTION_PRODUCTS)[number];
export const isDeductionProduct = (p: string): p is DeductionProduct =>
  (DEDUCTION_PRODUCTS as readonly string[]).includes(p);

// The monthly fee deducted for each, as staff set it (AppSetting).
export const feeKey = (product: string) => `coverage.fee.${product}`;

export interface EnrollmentRow {
  id: string;
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  product: string;
  action: string;
  status: string;
  applicationDate: Date | string;
  relativeName: string | null;
  deductionPeriod: string | null;
  paymentMethod: string | null;
  proratedPremium: number | null;
  premiumPaidAt: Date | string | null;
}

// Changes still to make to the รายการหัก: associations and relatives applied
// for or cancelled, not rejected, not yet put into a month's list.
export function outstandingDeductionChanges<T extends EnrollmentRow>(rows: T[]): { add: T[]; remove: T[] } {
  const open = rows.filter((r) => isDeductionProduct(r.product) && r.status !== "rejected" && !r.deductionPeriod);
  return {
    add: open.filter((r) => r.action === "enroll"),
    remove: open.filter((r) => r.action === "cancel"),
  };
}

// Life premiums applied for and not yet collected.
export function premiumsToCollect<T extends EnrollmentRow>(rows: T[]): T[] {
  return rows.filter(
    (r) => r.product === "life" && r.action === "enroll" && r.status !== "rejected" && !r.premiumPaidAt
  );
}

// By unit, the way the รายการหัก files are split; members with no unit last.
export function byUnit<T extends { unitName: string | null; memberNumber: string }>(rows: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const unit = r.unitName?.trim() || "ไม่ทราบหน่วยงาน";
    groups.set(unit, [...(groups.get(unit) ?? []), r]);
  }
  return [...groups]
    .map(([u, list]) => [u, [...list].sort((a, b) => a.memberNumber.localeCompare(b.memberNumber, undefined, { numeric: true }))] as [string, T[]])
    .sort(([a], [b]) => (a === "ไม่ทราบหน่วยงาน" ? 1 : b === "ไม่ทราบหน่วยงาน" ? -1 : a.localeCompare(b, "th")));
}

// Put into a month's รายการหัก, then หักไม่ได้ (and not paid since) in that
// month's round: the new fee did not come in with the rest.
export function enrolledButUndeducted<T extends EnrollmentRow>(rows: T[], uncollectedByPeriod: Map<string, Set<string>>): T[] {
  return rows.filter(
    (r) =>
      r.action === "enroll" &&
      r.status !== "rejected" &&
      !!r.deductionPeriod &&
      !!uncollectedByPeriod.get(r.deductionPeriod)?.has(r.memberNumber)
  );
}

// "MMYY" (Buddhist year) from a month input "2026-12".
export function periodOfMonth(month: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  return `${m[2]}${String((Number(m[1]) + 543) % 100).padStart(2, "0")}`;
}
