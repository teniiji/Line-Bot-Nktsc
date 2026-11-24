// ตารางผ่อนชำระ — an equal-instalment (ต้นรวมดอก) schedule for a loan.
//
// Interest each month is the remaining principal × annual rate ÷ 12, rounded
// UP to the next quarter baht (.25 .50 .75 .00), the way the cooperative
// quotes it. The instalment is either derived from the number of months
// (standard annuity payment, rounded to the satang) or given outright, in
// which case the number of months is however many it takes. Either way the
// schedule stops on the month the debt reaches zero; that last month pays
// only what is left.

export interface LoanScheduleInput {
  principal: number;
  // Percent per year: 1 means 1%.
  annualRatePercent: number;
  // ISO day of the first instalment, "2026-12-01".
  startDay: string;
  // Exactly one of these drives the schedule.
  months?: number;
  payment?: number;
}

export interface LoanScheduleRow {
  period: number;
  // ISO day this instalment falls due.
  day: string;
  opening: number;
  principalPaid: number;
  interest: number;
  amount: number;
  closing: number;
}

export interface LoanSchedule {
  payment: number;
  rows: LoanScheduleRow[];
  totalPrincipal: number;
  totalInterest: number;
  totalPaid: number;
}

export type LoanScheduleResult =
  | { ok: true; schedule: LoanSchedule }
  | { ok: false; problem: string };

// A schedule longer than this is a typo, not a loan.
export const MAX_PERIODS = 1200;

export const roundSatang = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// Up to the next 0.25. Rounded to the satang first so that 154.2500000001
// (floating point for an exact 154.25) does not become 154.50.
export const ceilQuarter = (x: number) => Math.max(0, Math.ceil(roundSatang(x) * 4 - 1e-9) / 4);

export const monthlyInterest = (balance: number, annualRatePercent: number) =>
  ceilQuarter((balance * annualRatePercent) / 100 / 12);

export function annuityPayment(principal: number, annualRatePercent: number, months: number): number {
  const i = annualRatePercent / 100 / 12;
  if (i === 0) return roundSatang(principal / months);
  return roundSatang((principal * i) / (1 - Math.pow(1 + i, -months)));
}

// The same day of the month, `offset` months on. A start on the 31st falls
// on the last day of a shorter month rather than spilling into the next one.
export function addMonths(day: string, offset: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export function buildLoanSchedule(input: LoanScheduleInput): LoanScheduleResult {
  const { principal, annualRatePercent, startDay } = input;
  if (!(principal > 0)) return { ok: false, problem: "กรุณาใส่เงินต้นมากกว่า 0" };
  if (!(annualRatePercent >= 0)) return { ok: false, problem: "กรุณาใส่อัตราดอกเบี้ยให้ถูกต้อง" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) return { ok: false, problem: "กรุณาเลือกวันที่เริ่มชำระ" };

  let payment: number;
  let maxPeriods: number;
  const fixedMonths = input.payment === undefined;
  if (fixedMonths) {
    const months = Math.round(input.months ?? NaN);
    if (!(months > 0)) return { ok: false, problem: "กรุณาใส่จำนวนงวดมากกว่า 0" };
    if (months > MAX_PERIODS) return { ok: false, problem: `จำนวนงวดต้องไม่เกิน ${MAX_PERIODS} งวด` };
    payment = annuityPayment(principal, annualRatePercent, months);
    maxPeriods = months;
  } else {
    payment = roundSatang(input.payment ?? NaN);
    if (!(payment > 0)) return { ok: false, problem: "กรุณาใส่ยอดชำระต่องวด" };
    const firstInterest = monthlyInterest(principal, annualRatePercent);
    if (payment <= firstInterest) {
      return {
        ok: false,
        problem: `ยอดชำระ ${payment.toFixed(2)} บาท ไม่พอจ่ายดอกเบี้ยงวดแรก ${firstInterest.toFixed(2)} บาท หนี้จะไม่มีวันหมด`,
      };
    }
    maxPeriods = MAX_PERIODS;
  }

  const rows: LoanScheduleRow[] = [];
  let balance = roundSatang(principal);
  for (let period = 1; period <= maxPeriods && balance > 0; period++) {
    const interest = monthlyInterest(balance, annualRatePercent);
    let principalPaid = roundSatang(payment - interest);
    // The last month settles whatever is left — a short final payment when
    // the instalment overshoots, or the rounding remainder on a fixed term.
    if (principalPaid >= balance || (fixedMonths && period === maxPeriods)) principalPaid = balance;
    const closing = roundSatang(balance - principalPaid);
    rows.push({
      period,
      day: addMonths(startDay, period - 1),
      opening: balance,
      principalPaid,
      interest,
      amount: roundSatang(principalPaid + interest),
      closing,
    });
    balance = closing;
  }
  if (balance > 0) {
    return { ok: false, problem: `ผ่อนเกิน ${MAX_PERIODS} งวดแล้วหนี้ยังไม่หมด ลองเพิ่มยอดชำระต่องวด` };
  }

  const totalPrincipal = roundSatang(rows.reduce((a, r) => a + r.principalPaid, 0));
  const totalInterest = roundSatang(rows.reduce((a, r) => a + r.interest, 0));
  return {
    ok: true,
    schedule: { payment, rows, totalPrincipal, totalInterest, totalPaid: roundSatang(totalPrincipal + totalInterest) },
  };
}
