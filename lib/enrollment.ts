// The register of applications to group life insurance and the cremation
// associations, made between one yearly coverage file and the next.
//
// Decided with the cooperative:
//   - several departments record applications, so each says who and where;
//   - an application takes effect from the day it is made;
//   - the life premium is charged for the rest of the policy year only, and
//     paid by deduction from a loan or by the member;
//   - who may apply is set by the cooperative's announcement, which staff
//     check and confirm on each application;
//   - the insurer and the associations send their decisions back as a file.

import { memberNumberKey } from "./memberNumber";

export const ENROLLMENT_PRODUCTS = {
  life: "ประกันชีวิตกลุ่ม",
  sok: "สสอค",
  scs: "สส.ชสอ",
  sst: "สส.สท",
  ssk: "สส.สก",
  relative: "ฌาปนกิจญาติ",
} as const;
export type EnrollmentProduct = keyof typeof ENROLLMENT_PRODUCTS;
export const isProduct = (v: unknown): v is EnrollmentProduct => typeof v === "string" && v in ENROLLMENT_PRODUCTS;

// The coverage file's flag for each association, to tell staff the member is
// already in it.
export const PRODUCT_ASSOC: Partial<Record<EnrollmentProduct, "hasSok" | "hasScs" | "hasSst" | "hasSsk">> = {
  sok: "hasSok",
  scs: "hasScs",
  sst: "hasSst",
  ssk: "hasSsk",
};

export const ACTIONS = { enroll: "สมัคร", cancel: "ยกเลิก" } as const;
export type EnrollmentAction = keyof typeof ACTIONS;

export const PAYMENT_METHODS = { loan: "หักจากเงินกู้", self: "จ่ายเอง" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const STATUSES = { pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ" } as const;
export type EnrollmentStatus = keyof typeof STATUSES;

// ---- The policy year --------------------------------------------------------
// Kept as the day and month it ends ("03-31"), since it repeats every year.
export const POLICY_YEAR_END_KEY = "coverage.policyYearEnd";

export function parseMonthDay(value: string | null | undefined): { month: number; day: number } | null {
  const m = /^(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

// The end of the policy year an application on this date falls in.
export function policyEndFor(applicationDate: Date, yearEnd: string | null): Date | null {
  const md = parseMonthDay(yearEnd);
  if (!md) return null;
  const y = applicationDate.getUTCFullYear();
  const thisYear = new Date(Date.UTC(y, md.month - 1, md.day));
  return applicationDate.getTime() <= thisYear.getTime() ? thisYear : new Date(Date.UTC(y + 1, md.month - 1, md.day));
}

// The premium for the rest of the policy year, by month: the month applied in
// counts whole, up to and including the month the policy year ends in.
export function remainingMonths(applicationDate: Date, policyEnd: Date): number {
  const months =
    policyEnd.getUTCFullYear() * 12 +
    policyEnd.getUTCMonth() -
    (applicationDate.getUTCFullYear() * 12 + applicationDate.getUTCMonth()) +
    1;
  return Math.min(12, Math.max(0, months));
}

export function proratedPremium(annual: number, applicationDate: Date, yearEnd: string | null): number | null {
  const end = policyEndFor(applicationDate, yearEnd);
  if (!end || !(annual > 0)) return null;
  return Math.round((annual * remainingMonths(applicationDate, end)) / 12);
}

// ---- Recording an application -----------------------------------------------
export interface EnrollmentInput {
  memberNumber: string;
  product: string;
  action: string;
  applicationDate: string;
  insuredSum?: number | null;
  annualPremium?: number | null;
  paymentMethod?: string | null;
  relativeName?: string | null;
  eligibilityChecked?: boolean;
  department?: string | null;
  recordedBy?: string | null;
}

export function enrollmentProblem(i: EnrollmentInput): string | null {
  if (!memberNumberKey(i.memberNumber)) return "ต้องใส่เลขสมาชิก";
  if (!isProduct(i.product)) return "ต้องเลือกว่าสมัครอะไร";
  if (!(i.action in ACTIONS)) return "ต้องเลือกสมัครหรือยกเลิก";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.applicationDate)) return "ต้องใส่วันที่สมัคร";
  if (!i.department?.trim()) return "ต้องเลือกแผนกที่รับเรื่อง";
  if (!i.recordedBy?.trim()) return "ต้องใส่ชื่อผู้บันทึก";
  if (i.action === "enroll") {
    if (!i.eligibilityChecked) return "ต้องตรวจคุณสมบัติตามประกาศก่อน แล้วติ๊กยืนยัน";
    if (i.product === "life") {
      if (!(Number(i.insuredSum) > 0)) return "ต้องใส่ทุนประกัน";
      if (!(Number(i.annualPremium) > 0)) return "ต้องใส่เบี้ยประกันทั้งปี";
      if (!(i.paymentMethod && i.paymentMethod in PAYMENT_METHODS)) return "ต้องเลือกวิธีชำระเบี้ย";
    }
    if (i.product === "relative" && !i.relativeName?.trim()) return "ต้องใส่ชื่อญาติที่สมัคร";
  }
  return null;
}

// ---- The insurer's and associations' result files ----------------------------
const MEMBER_HEADINGS = ["เลขสมาชิก", "เลขที่สมาชิก", "รหัสสมาชิก", "memberno", "membernumber"];
const RESULT_HEADINGS = ["ผลการพิจารณา", "ผลอนุมัติ", "ผล", "สถานะ", "result", "status"];

const key = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();

export function resultOf(value: unknown): EnrollmentStatus | null {
  const v = key(value);
  if (!v) return null;
  if (/ไม่|reject|ปฏิเสธ|no/.test(v)) return "rejected";
  if (/อนุมัติ|ผ่าน|approve|yes|ok/.test(v)) return "approved";
  return null;
}

export class ApprovalSheetError extends Error {}

// Member numbers listed in the file, each with the result it states when the
// file has a result column (null: take the one staff chose for the file).
export function parseApprovalSheet(pages: unknown[][][]): { memberNumber: string; result: EnrollmentStatus | null }[] {
  for (const rows of pages) {
    for (let h = 0; h < Math.min(rows.length, 10); h++) {
      const header = rows[h].map(key);
      const memberCol = header.findIndex((v) => MEMBER_HEADINGS.some((k) => v.includes(k)));
      if (memberCol < 0) continue;
      const resultCol = header.findIndex((v, i) => i !== memberCol && RESULT_HEADINGS.some((k) => v === k || v.startsWith(k)));
      const out = new Map<string, EnrollmentStatus | null>();
      for (const row of rows.slice(h + 1)) {
        const memberNumber = memberNumberKey(String(row[memberCol] ?? ""));
        if (!memberNumber || !/\d/.test(memberNumber)) continue;
        out.set(memberNumber, resultCol >= 0 ? resultOf(row[resultCol]) : null);
      }
      return [...out].map(([memberNumber, result]) => ({ memberNumber, result }));
    }
  }
  throw new ApprovalSheetError('ไม่พบหัวคอลัมน์ "เลขสมาชิก" ในไฟล์');
}

// ---- The month's summary -----------------------------------------------------
export interface SummaryRow {
  product: EnrollmentProduct;
  enrolled: number;
  cancelled: number;
  pending: number;
  approved: number;
  rejected: number;
  premium: number;
}

export function summarize(
  rows: { product: string; action: string; status: string; proratedPremium: number | null }[]
): SummaryRow[] {
  return (Object.keys(ENROLLMENT_PRODUCTS) as EnrollmentProduct[]).map((product) => {
    const mine = rows.filter((r) => r.product === product);
    const count = (f: (r: (typeof mine)[number]) => boolean) => mine.filter(f).length;
    return {
      product,
      enrolled: count((r) => r.action === "enroll"),
      cancelled: count((r) => r.action === "cancel"),
      pending: count((r) => r.status === "pending"),
      approved: count((r) => r.status === "approved"),
      rejected: count((r) => r.status === "rejected"),
      premium: mine
        .filter((r) => r.action === "enroll" && r.status !== "rejected")
        .reduce((s, r) => s + (r.proratedPremium ?? 0), 0),
    };
  });
}
