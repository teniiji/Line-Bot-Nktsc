// สิทธิกู้ — the cooperative's loan products and their rules, as published
// on its บริการเงินกู้ page (nktscoop.com/?page_id=3671) and the repayment
// tables linked from it (2569 editions; interest 5.25% a year on every type
// from 1 July 2568, the low-interest loan 4.50%).
//
// The tables' monthly payments do not all come from one formula — they were
// set by hand — so a loan of a listed amount uses the table's figure, and any
// other amount is worked out as an equal-payment loan, rounded up to the
// hundred, and marked as an estimate.
//
// These rules show what the member may ask for. The loan committee decides.

export type LoanProduct = "ordinary" | "living" | "transfer" | "lowInterest" | "restructure";

interface Tier {
  // Membership in months (งวดหุ้น) from which the cap applies.
  fromMonths: number;
  max: number;
}

export interface LoanProductRules {
  label: string;
  rate: number;
  terms: number[];
  min: number;
  max: number;
  // Months of membership needed at all.
  minMonths: number;
  // Caps by months of membership (highest tier reached applies).
  tiers: Tier[] | null;
  // Loan up to N times the monthly salary (สามัญ: 100 เท่า).
  salaryMultiple: number | null;
  // Caps by the member's age.
  ageCaps: { age: number; max: number }[] | null;
  // Shares the table lists against each amount, as a share of the loan.
  sharesRatio: number | null;
  // Guarantors needed: up to each amount, that many.
  guarantors: { upTo: number; count: number }[];
  // Salary that must remain after every deduction, as a share of salary,
  // for loans up to each amount.
  remaining: { upTo: number; pct: number }[] | null;
  // The published table: amount → payment per term.
  table: Record<number, Record<number, number>>;
  notes: string[];
}

const ORDINARY_150 = [1000, 1900, 2800, 3700, 4600, 5500, 6400, 7300, 8200, 9100, 10000, 10900, 11800, 12700, 13700, 14600, 15500, 16400, 17300, 18200, 19100, 20000, 20900, 21800, 22700, 23600, 24500, 25400, 26400, 27300];
const ORDINARY_240 = [700, 1400, 2100, 2700, 3400, 4100, 4700, 5400, 6100, 6700, 7400, 8100, 8800, 9400, 10100, 10800, 11400, 12100, 12800, 13400, 14100, 14800, 15500, 16100, 16800, 17500, 18100, 18800, 19500, 20100];
// 360 งวด at 5.25%: the restructuring table from 100,000, and the transfer
// table (from 1,000,000) agree where they overlap.
const LONG_360: Record<number, number> = {
  100000: 600, 200000: 1100, 300000: 1700, 400000: 2200, 500000: 2800, 600000: 3300, 700000: 3900, 800000: 4400, 900000: 5000,
  1000000: 5500, 1100000: 6100, 1200000: 6600, 1300000: 7200, 1400000: 7700, 1500000: 8300, 1600000: 8800, 1700000: 9400,
  1800000: 9900, 1900000: 10500, 2000000: 11000, 2100000: 11600, 2200000: 12100, 2300000: 12600, 2400000: 13200,
  2500000: 13700, 2600000: 14300, 2700000: 14800, 2800000: 15400, 2900000: 15900, 3000000: 16500, 3100000: 17000,
  3200000: 17600, 3300000: 18100, 3400000: 18700, 3500000: 19200, 3600000: 19800, 3700000: 20300, 3800000: 20900,
  3900000: 21400, 4000000: 22000, 4100000: 22500, 4200000: 23100, 4300000: 23600, 4400000: 24200, 4500000: 24700,
  4600000: 25200, 4700000: 25800, 4800000: 26300, 4900000: 26900, 5000000: 27400, 5100000: 28000, 5200000: 28500,
  5300000: 29100, 5400000: 29600, 5500000: 30200, 5550000: 30500,
};

const hundredThousands = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * 100000);

const ordinaryTable: Record<number, Record<number, number>> = Object.fromEntries(
  hundredThousands(30).map((a, i) => [a, { 150: ORDINARY_150[i], 240: ORDINARY_240[i] }])
);
const tableOf = (amounts: number[], term: number, src: Record<number, number>) =>
  Object.fromEntries(amounts.filter((a) => src[a] != null).map((a) => [a, { [term]: src[a] }]));

const STANDARD_GUARANTORS = [
  { upTo: 300000, count: 1 },
  { upTo: 600000, count: 2 },
  { upTo: 900000, count: 3 },
  { upTo: 1500000, count: 4 },
  { upTo: 2000000, count: 5 },
  { upTo: Infinity, count: 6 },
];

export const LOAN_PRODUCTS: Record<LoanProduct, LoanProductRules> = {
  ordinary: {
    label: "เงินกู้สามัญ",
    rate: 5.25,
    terms: [150, 240],
    min: 100000,
    max: 3000000,
    minMonths: 6,
    tiers: [
      { fromMonths: 6, max: 600000 },
      { fromMonths: 13, max: 800000 },
      { fromMonths: 19, max: 900000 },
      { fromMonths: 25, max: 1100000 },
      { fromMonths: 31, max: 1300000 },
      { fromMonths: 37, max: 1500000 },
      { fromMonths: 43, max: 1700000 },
      { fromMonths: 49, max: 1900000 },
      { fromMonths: 55, max: 2100000 },
      { fromMonths: 61, max: 2300000 },
      { fromMonths: 67, max: 2500000 },
      { fromMonths: 73, max: 2700000 },
      { fromMonths: 79, max: 3000000 },
    ],
    salaryMultiple: 100,
    ageCaps: [
      { age: 55, max: 3000000 },
      { age: 56, max: 2500000 },
      { age: 57, max: 2000000 },
    ],
    sharesRatio: 0.2,
    guarantors: STANDARD_GUARANTORS,
    remaining: [
      { upTo: 1500000, pct: 10 },
      { upTo: Infinity, pct: 15 },
    ],
    table: ordinaryTable,
    notes: [
      "สมาชิกที่ไม่เคยกู้ เงินเดือนคงเหลือไม่น้อยกว่า 30%",
      "ชำระหนี้มาแล้วอย่างน้อย 3 เดือนจึงกู้ใหม่ได้ ถ้าเงินเดือนคงเหลือไม่ถึงเกณฑ์ อนุมัติได้เท่าวงเงินเดิม",
      "กู้โดยใช้หุ้นค้ำประกัน ไม่ต้องมีผู้ค้ำ ได้ 90% ของหุ้น",
    ],
  },
  living: {
    label: "เงินกู้สามัญเพื่อการดำรงชีพ (ATM)",
    rate: 5.25,
    terms: [150],
    min: 100000,
    max: 2000000,
    minMonths: 3,
    tiers: [
      { fromMonths: 3, max: 200000 },
      { fromMonths: 4, max: 400000 },
      { fromMonths: 7, max: 600000 },
      { fromMonths: 10, max: 800000 },
      { fromMonths: 13, max: 1000000 },
      { fromMonths: 16, max: 1200000 },
      { fromMonths: 19, max: 1400000 },
      { fromMonths: 22, max: 1600000 },
      { fromMonths: 25, max: 1800000 },
      { fromMonths: 28, max: 2000000 },
    ],
    salaryMultiple: null,
    ageCaps: [
      { age: 55, max: 2000000 },
      { age: 56, max: 1500000 },
      { age: 57, max: 1000000 },
    ],
    sharesRatio: 0.2,
    guarantors: STANDARD_GUARANTORS.slice(0, 5),
    remaining: null,
    table: Object.fromEntries(hundredThousands(20).map((a, i) => [a, { 150: ORDINARY_150[i] }])),
    notes: ["ชำระหนี้มาแล้วอย่างน้อย 3 เดือนจึงยื่นกู้ใหม่ได้", "ยื่นได้ทุกวันทำการก่อน 12.00 น. กดเงินกู้ผ่าน ATM กรุงไทยได้วันถัดไป"],
  },
  transfer: {
    label: "เงินกู้พิเศษเพื่อการโอนหนี้",
    rate: 5.25,
    terms: [360],
    min: 1000000,
    max: 5550000,
    minMonths: 36,
    tiers: null,
    salaryMultiple: null,
    ageCaps: null,
    sharesRatio: 0.2,
    guarantors: [
      { upTo: 1000000, count: 3 },
      { upTo: 1500000, count: 4 },
      { upTo: 2000000, count: 5 },
      { upTo: Infinity, count: 6 },
    ],
    remaining: [
      { upTo: 3800000, pct: 30 },
      { upTo: Infinity, pct: 50 },
    ],
    table: tableOf(Object.keys(LONG_360).map(Number).filter((a) => a >= 1000000), 360, LONG_360),
    notes: ["โอนหนี้จากสถาบันการเงินอื่น ต้องแถลงหนี้และแนบเครดิตบูโร", "ออกจากราชการแบบไม่รับบำนาญ ต้องชำระให้เสร็จภายในอายุ 60 ปี"],
  },
  lowInterest: {
    label: "เงินกู้พิเศษดอกเบี้ยต่ำ 72 งวด",
    rate: 4.5,
    terms: [72],
    min: 50000,
    max: 500000,
    minMonths: 3,
    tiers: null,
    salaryMultiple: null,
    ageCaps: null,
    sharesRatio: 0.2,
    guarantors: [
      { upTo: 50000, count: 0 },
      { upTo: 200000, count: 1 },
      { upTo: Infinity, count: 2 },
    ],
    remaining: null,
    table: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [(i + 1) * 50000, { 72: (i + 1) * 800 }])),
    notes: [],
  },
  restructure: {
    label: "เงินกู้ปรับโครงสร้างหนี้",
    rate: 5.25,
    terms: [360],
    min: 100000,
    max: 3000000,
    minMonths: 0,
    tiers: null,
    salaryMultiple: null,
    ageCaps: null,
    sharesRatio: null,
    guarantors: STANDARD_GUARANTORS,
    remaining: null,
    table: tableOf(hundredThousands(30), 360, LONG_360),
    notes: ["ตามเงื่อนไขโครงการ/มติคณะกรรมการ"],
  },
};

// ---- Payments --------------------------------------------------------------

export function equalPayment(amount: number, ratePct: number, months: number): number {
  const r = ratePct / 100 / 12;
  if (amount <= 0 || months <= 0) return 0;
  return r === 0 ? amount / months : (amount * r) / (1 - (1 + r) ** -months);
}

export function monthlyPayment(product: LoanProduct, amount: number, term: number): { payment: number; fromTable: boolean } {
  const p = LOAN_PRODUCTS[product];
  const listed = p.table[amount]?.[term];
  if (listed != null) return { payment: listed, fromTable: true };
  return { payment: Math.ceil(equalPayment(amount, p.rate, term) / 100) * 100, fromTable: false };
}

// ---- Eligibility -------------------------------------------------------------

export interface EligibilityInput {
  product: LoanProduct;
  amount: number;
  term: number;
  age: number | null;
  // Months of membership (งวดหุ้น).
  months: number | null;
  shares: number;
  salary: number | null;
  // Every monthly deduction other than loan repayments (หุ้นรายเดือน,
  // ภาษี, กบข., premiums, other creditors).
  otherDeductions: number;
  // Repayments on the member's current loans, and the part of them the new
  // loan pays off.
  currentRepayments: number;
  refinancedRepayments: number;
  neverBorrowed: boolean;
}

export type CheckState = "ok" | "fail" | "unknown";

export interface EligibilityCheck {
  label: string;
  state: CheckState;
  detail: string;
}

export interface Eligibility {
  payment: number;
  fromTable: boolean;
  // The most the rules allow before the salary test.
  capByRules: number | null;
  capReasons: string[];
  // The most the rules and the remaining-salary test both allow, in steps of
  // 100,000 (50,000 for the low-interest loan). Shares are left out: the
  // member can buy more.
  maxAmount: number | null;
  guarantors: number;
  sharesNeeded: number | null;
  remaining: number | null;
  remainingPct: number | null;
  requiredPct: number | null;
  checks: EligibilityCheck[];
  notes: string[];
}

const fmt = (x: number) => x.toLocaleString("th-TH", { maximumFractionDigits: 0 });

function tierCap(p: LoanProductRules, months: number | null): number | null {
  if (!p.tiers || months == null) return null;
  const reached = p.tiers.filter((t) => months >= t.fromMonths);
  return reached.length ? reached[reached.length - 1].max : 0;
}

function ageCap(p: LoanProductRules, age: number | null): { max: number | null; unknown: boolean } {
  if (!p.ageCaps || age == null) return { max: null, unknown: false };
  const first = p.ageCaps[0];
  const last = p.ageCaps[p.ageCaps.length - 1];
  if (age < first.age) return { max: null, unknown: false };
  if (age > last.age) return { max: null, unknown: true };
  return { max: p.ageCaps.find((c) => c.age === age)?.max ?? null, unknown: false };
}

function requiredPct(p: LoanProductRules, amount: number, neverBorrowed: boolean): number | null {
  if (neverBorrowed && p === LOAN_PRODUCTS.ordinary) return 30;
  return p.remaining?.find((r) => amount <= r.upTo)?.pct ?? null;
}

export function assessEligibility(i: EligibilityInput): Eligibility {
  const p = LOAN_PRODUCTS[i.product];
  const term = p.terms.includes(i.term) ? i.term : p.terms[0];
  const { payment, fromTable } = monthlyPayment(i.product, i.amount, term);
  const checks: EligibilityCheck[] = [];

  // What the rules cap the amount at, and why.
  const caps: { max: number; why: string }[] = [{ max: p.max, why: `เพดาน${p.label} ${fmt(p.max)}` }];
  const tc = tierCap(p, i.months);
  if (tc != null) caps.push({ max: tc, why: `เป็นสมาชิก ${i.months} งวด กู้ได้ไม่เกิน ${fmt(tc)}` });
  if (p.salaryMultiple && i.salary) caps.push({ max: p.salaryMultiple * i.salary, why: `${p.salaryMultiple} เท่าของเงินเดือน = ${fmt(p.salaryMultiple * i.salary)}` });
  const ac = ageCap(p, i.age);
  if (ac.max != null) caps.push({ max: ac.max, why: `อายุ ${i.age} ปี กู้ได้ไม่เกิน ${fmt(ac.max)}` });
  const capByRules = Math.min(...caps.map((c) => c.max));
  const binding = caps.filter((c) => c.max === capByRules).map((c) => c.why);

  checks.push({
    label: "วงเงินตามประเภทเงินกู้",
    state: i.amount >= p.min && i.amount <= p.max ? "ok" : "fail",
    detail: `${fmt(p.min)} – ${fmt(p.max)} บาท`,
  });
  if (i.months == null) {
    checks.push({ label: "อายุการเป็นสมาชิก", state: "unknown", detail: "ไม่ทราบจำนวนงวดหุ้น" });
  } else {
    checks.push({
      label: "อายุการเป็นสมาชิก",
      state: i.months >= p.minMonths && (tc == null || i.amount <= tc) ? "ok" : "fail",
      detail:
        `${i.months} งวด` +
        (p.minMonths ? ` (ขั้นต่ำ ${p.minMonths} งวด)` : "") +
        (tc != null ? ` · วงเงินตามอายุสมาชิกไม่เกิน ${fmt(tc)}` : ""),
    });
  }
  if (p.salaryMultiple) {
    checks.push(
      i.salary
        ? {
            label: `ไม่เกิน ${p.salaryMultiple} เท่าของเงินเดือน`,
            state: i.amount <= p.salaryMultiple * i.salary ? "ok" : "fail",
            detail: `${p.salaryMultiple} × ${fmt(i.salary)} = ${fmt(p.salaryMultiple * i.salary)}`,
          }
        : { label: `ไม่เกิน ${p.salaryMultiple} เท่าของเงินเดือน`, state: "unknown", detail: "ใส่เงินเดือนเพื่อตรวจ" }
    );
  }
  if (p.ageCaps) {
    checks.push(
      i.age == null
        ? { label: "อายุตัวสมาชิก", state: "unknown", detail: "ไม่ทราบอายุ" }
        : ac.unknown
          ? { label: "อายุตัวสมาชิก", state: "unknown", detail: `อายุ ${i.age} ปี — ตารางกำหนดถึงอายุ ${p.ageCaps[p.ageCaps.length - 1].age} ปี ตรวจระเบียบเพิ่ม` }
          : { label: "อายุตัวสมาชิก", state: ac.max == null || i.amount <= ac.max ? "ok" : "fail", detail: ac.max == null ? `อายุ ${i.age} ปี` : `อายุ ${i.age} ปี กู้ได้ไม่เกิน ${fmt(ac.max)}` }
    );
  }
  const sharesNeeded = p.sharesRatio != null ? Math.round(i.amount * p.sharesRatio) : null;
  if (sharesNeeded != null) {
    checks.push({
      label: "หุ้นตามตาราง",
      state: i.shares >= sharesNeeded ? "ok" : "fail",
      detail: `ต้องมี ${fmt(sharesNeeded)} (${p.sharesRatio! * 100}% ของวงเงิน) · มี ${fmt(i.shares)}`,
    });
  }

  // The salary left after the new loan.
  const req = requiredPct(p, i.amount, i.neverBorrowed);
  let remaining: number | null = null;
  let remainingPct: number | null = null;
  const leftAfter = (pay: number) => (i.salary ?? 0) - i.otherDeductions - (i.currentRepayments - i.refinancedRepayments) - pay;
  if (i.salary) {
    remaining = Math.round(leftAfter(payment));
    remainingPct = Math.round((remaining / i.salary) * 1000) / 10;
    checks.push({
      label: "เงินเดือนคงเหลือหลังหัก",
      state: req == null ? (remaining >= 0 ? "ok" : "fail") : remainingPct >= req ? "ok" : "fail",
      detail: `${fmt(remaining)} บาท (${remainingPct}%)${req != null ? ` · ต้องไม่น้อยกว่า ${req}%` : ""}`,
    });
  } else {
    checks.push({ label: "เงินเดือนคงเหลือหลังหัก", state: "unknown", detail: "ใส่เงินเดือนและยอดหักอื่นเพื่อตรวจ" });
  }

  // The largest amount the rules and the salary test both allow.
  const step = i.product === "lowInterest" ? 50000 : 100000;
  let maxAmount: number | null = null;
  for (let a = Math.floor(capByRules / step) * step; a >= p.min; a -= step) {
    if (i.salary) {
      const left = leftAfter(monthlyPayment(i.product, a, term).payment);
      const need = requiredPct(p, a, i.neverBorrowed);
      if (need != null ? (left / i.salary) * 100 < need : left < 0) continue;
    }
    maxAmount = a;
    break;
  }
  if (i.months != null && i.months < p.minMonths) maxAmount = null;

  return {
    payment,
    fromTable,
    capByRules,
    capReasons: binding,
    maxAmount,
    guarantors: p.guarantors.find((g) => i.amount <= g.upTo)?.count ?? p.guarantors[p.guarantors.length - 1].count,
    sharesNeeded,
    remaining,
    remainingPct,
    requiredPct: req,
    checks,
    notes: p.notes,
  };
}
