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

// ─── สิทธิกู้และยอดผ่อน ────────────────────────────────────────────────────
//
// The cooperative's published repayment tables (www.nktscoop.com, page
// "บริการเงินกู้", tables dated 2569): for each loan type, rows of
// "วงเงินกู้ไม่เกิน" with the membership needed, the shares (20% of the loan),
// the guarantors and the monthly payment per term. The published payments are
// not exactly any one formula (each is the level payment rounded to the
// hundred, sometimes up, sometimes to nearest), so a row's own figure is used
// when the amount, term and rate match the table; any other amount gets the
// level (ต้นและดอกเบี้ยเท่ากัน) payment rounded up to the hundred, marked as
// an estimate.

export type LoanType = "ordinary" | "living" | "transfer" | "lowRate" | "restructure";

export interface ScheduleRow {
  upTo: number;
  // Months of membership needed (from อายุสมาชิก), null when none is given.
  minMemberMonths: number | null;
  guarantors: number;
  // Monthly payment by term.
  pay: Record<number, number>;
}

export interface LoanProduct {
  type: LoanType;
  label: string;
  // Yearly rate, percent.
  rate: number;
  terms: number[];
  cap: number;
  // Shares needed as a share of the loan (0.2 = 20%), null when not asked.
  shareRatio: number | null;
  // Highest loan by age: [age up to, cap]; past the last age the rule is not
  // on the published page.
  ageCaps: [number, number][];
  // Loan up to this many times the monthly salary.
  salaryMultiple: number | null;
  rows: ScheduleRow[];
  notes: string[];
}

const steps = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let x = from; x <= to + 1e-6; x += step) out.push(Math.round(x));
  return out;
};
// The guarantor scale shared by the สามัญ-type tables.
const guarantorsFor = (amount: number) =>
  amount <= 300000 ? 1 : amount <= 600000 ? 2 : amount <= 900000 ? 3 : amount <= 1500000 ? 4 : amount <= 2000000 ? 5 : 6;
// Membership months needed, as [loan up to, months] bands.
const bandOf = (bands: [number, number][], amount: number) => bands.find(([upTo]) => amount <= upTo)?.[1] ?? bands[bands.length - 1][1];

const PAY_150 = [
  1000, 1900, 2800, 3700, 4600, 5500, 6400, 7300, 8200, 9100, 10000, 10900, 11800, 12700, 13700, 14600, 15500, 16400, 17300, 18200,
  19100, 20000, 20900, 21800, 22700, 23600, 24500, 25400, 26400, 27300,
];
const PAY_240 = [
  700, 1400, 2100, 2700, 3400, 4100, 4700, 5400, 6100, 6700, 7400, 8100, 8800, 9400, 10100, 10800, 11400, 12100, 12800, 13400,
  14100, 14800, 15500, 16100, 16800, 17500, 18100, 18800, 19500, 20100,
];
const PAY_360 = [
  600, 1100, 1700, 2200, 2800, 3300, 3900, 4400, 5000, 5500, 6100, 6600, 7200, 7700, 8300, 8800, 9400, 9900, 10500, 11000, 11600,
  12100, 12600, 13200, 13700, 14300, 14800, 15400, 15900, 16500,
];
// พิเศษเพื่อการโอนหนี้, 1,000,000 to 5,550,000: the same figures as ปรับ
// โครงสร้างหนี้ to 3,000,000, then its own (the second page runs a little
// under the level payment).
const PAY_TRANSFER = [
  ...PAY_360.slice(9),
  17000, 17600, 18100, 18700, 19200, 19800, 20300, 20900,
  21400, 22000, 22500, 23100, 23600, 24200, 24700, 25200, 25800, 26300, 26900, 27400, 28000, 28500, 29100, 29600, 30200, 30500,
];

const ORDINARY_MONTHS: [number, number][] = [
  [600000, 6], [800000, 13], [900000, 19], [1100000, 25], [1300000, 31], [1500000, 37], [1700000, 43], [1900000, 49],
  [2100000, 55], [2300000, 61], [2500000, 67], [2700000, 73], [3000000, 79],
];
const LIVING_MONTHS: [number, number][] = [
  [200000, 3], [400000, 4], [600000, 7], [800000, 10], [1000000, 13], [1200000, 16], [1400000, 19], [1600000, 22], [1800000, 25],
  [2000000, 28],
];

export const LOAN_PRODUCTS: Record<LoanType, LoanProduct> = {
  ordinary: {
    type: "ordinary",
    label: "เงินกู้สามัญ",
    rate: 5.25,
    terms: [150, 240],
    cap: 3000000,
    shareRatio: 0.2,
    ageCaps: [[55, 3000000], [56, 2500000], [57, 2000000]],
    salaryMultiple: 100,
    rows: steps(100000, 3000000, 100000).map((upTo, i) => ({
      upTo,
      minMemberMonths: bandOf(ORDINARY_MONTHS, upTo),
      guarantors: guarantorsFor(upTo),
      pay: { 150: PAY_150[i], 240: PAY_240[i] },
    })),
    notes: [
      "ชำระหนี้มาแล้วอย่างน้อย 3 เดือนจึงยื่นกู้ใหม่ได้",
      "เงินเดือนคงเหลือ: กู้ไม่เกิน 1,500,000 เหลือไม่น้อยกว่า 10% · เกิน 1,500,000 เหลือไม่น้อยกว่า 15% · สมาชิกใหม่ที่ไม่เคยกู้ 30%",
      "กู้โดยใช้หุ้นค้ำประกันได้ไม่เกิน 90% ของหุ้น ไม่ต้องมีผู้ค้ำ",
    ],
  },
  living: {
    type: "living",
    label: "เงินกู้สามัญเพื่อการดำรงชีพ (ATM)",
    rate: 5.25,
    terms: [150],
    cap: 2000000,
    shareRatio: 0.2,
    ageCaps: [[55, 2000000], [56, 1500000], [57, 1000000]],
    salaryMultiple: null,
    rows: steps(100000, 2000000, 100000).map((upTo, i) => ({
      upTo,
      minMemberMonths: bandOf(LIVING_MONTHS, upTo),
      guarantors: guarantorsFor(upTo),
      pay: { 150: PAY_150[i] },
    })),
    notes: ["ชำระหนี้มาแล้วอย่างน้อย 3 เดือนจึงยื่นกู้ใหม่ได้", "รับเงินกู้ผ่านตู้ ATM กรุงไทย (บริการอื่นๆ → สหกรณ์ → รับเงินกู้)"],
  },
  transfer: {
    type: "transfer",
    label: "เงินกู้พิเศษเพื่อการโอนหนี้",
    rate: 5.25,
    terms: [360],
    cap: 5550000,
    shareRatio: 0.2,
    ageCaps: [],
    salaryMultiple: null,
    rows: [...steps(1000000, 5500000, 100000), 5550000].map((upTo, i) => ({
      upTo,
      minMemberMonths: 36,
      guarantors: upTo <= 1000000 ? 3 : guarantorsFor(upTo),
      pay: { 360: PAY_TRANSFER[i] },
    })),
    notes: ["สมาชิกตั้งแต่ 36 เดือนขึ้นไป", "มีเงื่อนไขเงินเดือนคงเหลือหลังหักตามตารางของสหกรณ์"],
  },
  lowRate: {
    type: "lowRate",
    label: "เงินกู้พิเศษดอกเบี้ยต่ำ 72 งวด",
    rate: 4.5,
    terms: [72],
    cap: 500000,
    shareRatio: 0.2,
    ageCaps: [],
    salaryMultiple: null,
    rows: steps(50000, 500000, 50000).map((upTo) => ({
      upTo,
      minMemberMonths: 3,
      guarantors: upTo <= 50000 ? 0 : upTo <= 200000 ? 1 : 2,
      pay: { 72: (upTo / 50000) * 800 },
    })),
    notes: ["ส่งหุ้นมาแล้ว 3 งวดขึ้นไป"],
  },
  restructure: {
    type: "restructure",
    label: "เงินกู้ปรับโครงสร้างหนี้",
    rate: 5.25,
    terms: [360],
    cap: 3000000,
    shareRatio: null,
    ageCaps: [],
    salaryMultiple: null,
    rows: steps(100000, 3000000, 100000).map((upTo, i) => ({
      upTo,
      minMemberMonths: null,
      guarantors: guarantorsFor(upTo),
      pay: { 360: PAY_360[i] },
    })),
    notes: [],
  },
};

// The level monthly payment (ต้นและดอกเบี้ยเท่ากันทุกงวด).
export function levelPayment(principal: number, ratePct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = ratePct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - (1 + r) ** -months);
}

export function installmentFor(
  product: LoanProduct,
  amount: number,
  term: number,
  rate: number
): { amount: number; fromTable: boolean } {
  const row = product.rows.find((r) => r.upTo === amount);
  const listed = row?.pay[term];
  if (listed && rate === product.rate) return { amount: listed, fromTable: true };
  return { amount: Math.ceil(levelPayment(amount, rate, term) / 100) * 100, fromTable: false };
}

export interface EntitlementInput {
  type: LoanType;
  amount: number;
  // Empty: the type's first term.
  termMonths: number | null;
  // Empty: the type's rate.
  rate: number | null;
  age: number | null;
  // Months of membership; the number of share periods paid stands in for it.
  memberMonths: number | null;
  shares: number;
  salary: number | null;
  // What else is deducted from the salary each month after this loan
  // (other loans not paid off, shares, premiums…).
  otherDeductions: number | null;
  // From assessLoan: the largest loan มั่นใจได้ covers.
  collateralMax: number | null;
}

export interface EntitlementLimit {
  key: string;
  label: string;
  amount: number;
  note: string | null;
}

export interface EntitlementCheck {
  label: string;
  ok: boolean;
  note: string;
}

export interface LoanEntitlement {
  product: LoanProduct;
  term: number;
  rate: number;
  installment: number;
  fromTable: boolean;
  totalPaid: number;
  totalInterest: number;
  // The table row the amount falls in (วงเงินกู้ไม่เกิน), null past the cap.
  row: ScheduleRow | null;
  sharesNeeded: number | null;
  limits: EntitlementLimit[];
  // The lowest of the limits: what the rules allow.
  ruleMax: number;
  // The lower of ruleMax and the collateral limit, and which one binds.
  overallMax: number;
  binding: "rule" | "collateral" | null;
  checks: EntitlementCheck[];
  remainingSalary: number | null;
  warnings: string[];
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const th = (x: number) => x.toLocaleString("th-TH", { maximumFractionDigits: 2 });

export function assessEntitlement(input: EntitlementInput): LoanEntitlement {
  const product = LOAN_PRODUCTS[input.type];
  const warnings: string[] = [];
  const amount = Math.max(0, input.amount);
  let term = input.termMonths && input.termMonths > 0 ? input.termMonths : product.terms[0];
  const maxTerm = Math.max(...product.terms);
  if (term > maxTerm) {
    warnings.push(`${product.label} ผ่อนได้ไม่เกิน ${maxTerm} งวด — คำนวณที่ ${maxTerm} งวด`);
    term = maxTerm;
  } else if (!product.terms.includes(term)) {
    warnings.push(`ตารางสหกรณ์มี ${product.terms.join(" / ")} งวด — ${term} งวดเป็นยอดประมาณ`);
  }
  const rate = input.rate != null && input.rate >= 0 ? input.rate : product.rate;
  if (rate !== product.rate) warnings.push(`ใช้อัตราดอกเบี้ย ${rate}% แทนอัตราประกาศ ${product.rate}%`);

  const { amount: installment, fromTable } = installmentFor(product, amount, term, rate);
  const exactTotal = round2(levelPayment(amount, rate, term) * term);
  const row = product.rows.find((r) => amount <= r.upTo) ?? null;

  const limits: EntitlementLimit[] = [{ key: "cap", label: "วงเงินสูงสุดของประเภทเงินกู้", amount: product.cap, note: null }];
  if (product.ageCaps.length && input.age != null) {
    const band = product.ageCaps.find(([age]) => input.age! <= age);
    if (band) {
      if (band[1] < product.cap) limits.push({ key: "age", label: `อายุ ${input.age} ปี`, amount: band[1], note: `อายุไม่เกิน ${band[0]} ปี กู้ได้ไม่เกิน ${th(band[1])}` });
    } else {
      const last = product.ageCaps[product.ageCaps.length - 1];
      limits.push({ key: "age", label: `อายุ ${input.age} ปี`, amount: last[1], note: `ระเบียบบนเว็บไซต์ระบุถึงอายุ ${last[0]} ปี — ตรวจระเบียบก่อนอนุมัติ` });
      warnings.push(`อายุ ${input.age} ปี เกินช่วงที่ตารางระบุ (${last[0]} ปี) — ตรวจระเบียบก่อนอนุมัติ`);
    }
  }
  if (product.salaryMultiple && input.salary && input.salary > 0) {
    limits.push({
      key: "salary",
      label: `${product.salaryMultiple} เท่าของเงินเดือน`,
      amount: round2(input.salary * product.salaryMultiple),
      note: `เงินเดือน ${th(input.salary)}`,
    });
  }
  if (product.shareRatio) {
    limits.push({
      key: "shares",
      label: `หุ้นต้องมี ${pct(product.shareRatio)} ของวงเงิน`,
      amount: Math.floor(input.shares / product.shareRatio / 1000) * 1000,
      note: `หุ้น ${th(input.shares)}`,
    });
  }
  if (input.memberMonths != null && product.rows.some((r) => r.minMemberMonths != null)) {
    const fits = product.rows.filter((r) => r.minMemberMonths != null && r.minMemberMonths <= input.memberMonths!);
    limits.push({
      key: "membership",
      label: `อายุสมาชิก ${input.memberMonths} เดือน`,
      amount: fits.length ? fits[fits.length - 1].upTo : 0,
      note: "ประมาณจากจำนวนงวดหุ้นที่ส่ง",
    });
  }
  const ruleMax = Math.max(0, Math.min(...limits.map((l) => l.amount)));

  const byCollateral = input.collateralMax != null && input.collateralMax < ruleMax;
  const overallMax = byCollateral ? Math.max(0, input.collateralMax!) : ruleMax;

  const checks: EntitlementCheck[] = [];
  if (amount > 0) {
    checks.push({
      label: "ไม่เกินสิทธิกู้ตามระเบียบ",
      ok: amount <= ruleMax,
      note: `สิทธิสูงสุด ${th(ruleMax)}`,
    });
    if (input.collateralMax != null) {
      checks.push({
        label: "หลักประกันมั่นใจได้ครอบคลุม",
        ok: amount <= input.collateralMax,
        note: `หลักประกันรองรับได้ ${th(Math.max(0, input.collateralMax))}`,
      });
    }
  }
  let remainingSalary: number | null = null;
  if (input.salary && input.salary > 0 && amount > 0) {
    remainingSalary = round2(input.salary - Math.max(0, input.otherDeductions ?? 0) - installment);
    const share = remainingSalary / input.salary;
    if (input.type === "ordinary") {
      const need = amount > 1500000 ? 0.15 : 0.1;
      checks.push({
        label: `เงินเดือนคงเหลือไม่น้อยกว่า ${pct(need)}`,
        ok: share >= need,
        note: `เหลือ ${th(remainingSalary)} (${pct(share)}) · สมาชิกใหม่ที่ไม่เคยกู้ต้องเหลือ 30%`,
      });
    } else {
      checks.push({ label: "เงินเดือนคงเหลือหลังผ่อน", ok: remainingSalary > 0, note: `เหลือ ${th(remainingSalary)} (${pct(share)})` });
    }
  }

  if (amount > product.cap) warnings.push(`วงเงินเกินเพดาน ${product.label} ${th(product.cap)}`);
  if (input.memberMonths == null) warnings.push("ไม่ทราบอายุสมาชิก — ตรวจอายุสมาชิกตามตารางเอง");
  if (input.age == null && product.ageCaps.length) warnings.push("ไม่ทราบอายุ — ตรวจเพดานตามอายุเอง");

  return {
    product,
    term,
    rate,
    installment,
    fromTable,
    totalPaid: round2(installment * term),
    totalInterest: round2(Math.max(0, exactTotal - amount)),
    row,
    sharesNeeded: product.shareRatio && amount > 0 ? round2((row?.upTo ?? amount) * product.shareRatio) : null,
    limits,
    ruleMax,
    overallMax,
    binding: input.collateralMax == null ? null : byCollateral ? "collateral" : "rule",
    checks,
    remainingSalary,
    warnings,
  };
}
