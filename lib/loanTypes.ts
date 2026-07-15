export const LOAN_TYPES = [
  "สามัญ",
  "ดำรงชีพ(ATM)",
  "ฉุกเฉิน",
  "ดอกเบี้ยต่ำ",
  "รวมหนี้",
] as const;

export type LoanType = (typeof LOAN_TYPES)[number];
