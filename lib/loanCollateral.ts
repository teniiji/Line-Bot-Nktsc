// คำนวณก่อนกู้ — would what a member leaves behind cover what they would owe
// after this loan?
//
// The same five sources as the coverage tab (lib/coverage.ts): shares, the
// group life policy, the member's own cremation associations, and the
// cooperative's welfare; a relative's membership never counts. The debt is
// what the member owes now, less what the new contract pays off, plus the
// new loan.
//
// Two totals are given side by side, so staff are never asked to choose a
// policy in the moment:
//   - รวม: everything the member holds;
//   - มั่นใจได้: leaving out what might not pay — a premium or fee that
//     could not be deducted, an application not yet approved, and a life
//     policy that would end (by the insurer's age limit) before the loan does.

import { parseUndeducted, type AssocKey, type CoverageRates } from "./coverage";

export interface LoanSettings {
  // The age past which the group policy no longer covers.
  maxCoverAge: number;
  // The yearly premium per 1,000,000 of cover.
  premiumPerMillion: number;
}

export const DEFAULT_LOAN_SETTINGS: LoanSettings = { maxCoverAge: 80, premiumPerMillion: 9600 };
export const LOAN_SETTINGS_KEYS = { maxCoverAge: "loan.maxCoverAge", premiumPerMillion: "loan.premiumPerMillion" } as const;

export interface MemberHoldings {
  age: number | null;
  sharePeriods: number | null;
  shares: number;
  debt: number;
  insuredSum: number;
  premiumDeducted: boolean | null;
  hasSok: boolean;
  hasScs: boolean;
  hasSst: boolean;
  hasSsk: boolean;
  undeducted: string | null;
  // Products held only through an application still waiting for approval.
  pending: string[];
}

export interface LoanRequest {
  amount: number;
  // What the new contract pays off of the member's current debt.
  refinance: number;
  // The term in months, to see whether the policy outlasts it.
  termMonths: number | null;
}

export interface CollateralItem {
  key: string;
  label: string;
  amount: number;
  // Counted in มั่นใจได้.
  sure: boolean;
  note: string | null;
}

export interface LoanAssessment {
  items: CollateralItem[];
  total: number;
  sureTotal: number;
  debtNow: number;
  debtAfter: number;
  margin: number;
  sureMargin: number;
  // Cover to add so that มั่นใจได้ is enough, when it is not.
  topUp: { insuredSum: number; premium: number; possible: boolean; reason: string | null } | null;
  // The largest loan มั่นใจได้ covers with nothing added.
  maxLoan: number;
  warnings: string[];
}

const ASSOC: { key: AssocKey; product: string; label: string; rate: keyof CoverageRates }[] = [
  { key: "hasSok", product: "sok", label: "ฌาปนกิจ สสอค.", rate: "benefitSok" },
  { key: "hasScs", product: "scs", label: "ฌาปนกิจ สส.ชสอ.", rate: "benefitScs" },
  { key: "hasSst", product: "sst", label: "ฌาปนกิจ สส.สท.", rate: "benefitSst" },
  { key: "hasSsk", product: "ssk", label: "ฌาปนกิจ สส.สก.", rate: "benefitSsk" },
];

const round2 = (x: number) => Math.round(x * 100) / 100;

export function assessLoan(
  m: MemberHoldings,
  loan: LoanRequest,
  rates: CoverageRates,
  settings: LoanSettings = DEFAULT_LOAN_SETTINGS
): LoanAssessment {
  const undeducted = parseUndeducted(m.undeducted);
  const items: CollateralItem[] = [];
  const warnings: string[] = [];

  items.push({ key: "shares", label: "หุ้น", amount: m.shares, sure: true, note: null });

  if (m.insuredSum > 0) {
    const reasons: string[] = [];
    if (m.pending.includes("life")) reasons.push("ใบสมัครยังรออนุมัติ");
    if (undeducted.premium || m.premiumDeducted === false) reasons.push("หักเบี้ยประกันไม่ได้");
    const endAge = m.age != null && loan.termMonths ? m.age + loan.termMonths / 12 : null;
    if (endAge != null && endAge > settings.maxCoverAge) {
      reasons.push(`สัญญาจบตอนอายุ ${Math.ceil(endAge)} ปี เกินอายุคุ้มครอง ${settings.maxCoverAge} ปี`);
    }
    if (m.age != null && m.age >= settings.maxCoverAge) reasons.push(`อายุ ${m.age} ปี เกินอายุคุ้มครองแล้ว`);
    items.push({ key: "life", label: "ทุนประกันชีวิตกลุ่ม", amount: m.insuredSum, sure: reasons.length === 0, note: reasons.join(" · ") || null });
  }

  for (const a of ASSOC) {
    if (!m[a.key]) continue;
    const reasons: string[] = [];
    if (m.pending.includes(a.product)) reasons.push("ใบสมัครยังรออนุมัติ");
    if (undeducted.associations.includes(a.key)) reasons.push("หักค่าบำรุงไม่ได้");
    items.push({ key: a.product, label: a.label, amount: rates[a.rate], sure: reasons.length === 0, note: reasons.join(" · ") || null });
  }

  const rawWelfare = Math.max(0, m.sharePeriods ?? 0) * rates.welfarePerPeriod;
  const welfare = Math.min(rawWelfare, rates.welfareCap);
  items.push({
    key: "welfare",
    label: "สวัสดิการสหกรณ์",
    amount: welfare,
    sure: true,
    note: `${m.sharePeriods ?? 0} งวด × ${rates.welfarePerPeriod.toLocaleString("th-TH")}${rawWelfare > rates.welfareCap ? " (เต็มเพดาน)" : ""}`,
  });

  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  const sureTotal = round2(items.filter((i) => i.sure).reduce((s, i) => s + i.amount, 0));
  const refinance = Math.min(Math.max(0, loan.refinance), m.debt);
  if (loan.refinance > m.debt) warnings.push("ยอดหักกลบมากกว่าหนี้คงเหลือ — ใช้เท่าหนี้คงเหลือ");
  const debtAfter = round2(m.debt - refinance + Math.max(0, loan.amount));
  const margin = round2(total - debtAfter);
  const sureMargin = round2(sureTotal - debtAfter);

  let topUp: LoanAssessment["topUp"] = null;
  if (sureMargin < 0) {
    const insuredSum = Math.ceil(-sureMargin / 100000) * 100000;
    const premium = Math.round((insuredSum * settings.premiumPerMillion) / 1_000_000);
    const life = items.find((i) => i.key === "life");
    let reason: string | null = null;
    if (m.age != null && loan.termMonths && m.age + loan.termMonths / 12 > settings.maxCoverAge) {
      reason = `อายุเมื่อสัญญาจบเกิน ${settings.maxCoverAge} ปี เพิ่มทุนประกันแล้วก็ไม่คุ้มครองถึงสิ้นสัญญา`;
    } else if (life && !life.sure) {
      reason = `ประกันเดิมยังนับไม่ได้ (${life.note}) — แก้ก่อนแล้วจึงเพิ่มทุน`;
    }
    topUp = { insuredSum, premium, possible: reason == null, reason };
  }

  if (m.pending.length) warnings.push("มีใบสมัครที่ยังรออนุมัติ — ไม่นับในยอดมั่นใจได้จนกว่าจะอนุมัติ");
  if (m.age == null) warnings.push("ไม่ทราบอายุสมาชิก — ตรวจอายุคุ้มครองประกันเอง");

  return {
    items,
    total,
    sureTotal,
    debtNow: m.debt,
    debtAfter,
    margin,
    sureMargin,
    topUp,
    maxLoan: Math.max(0, round2(sureTotal - (m.debt - refinance))),
    warnings,
  };
}
