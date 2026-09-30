// Money a round can only hear about from staff: nothing on either bank
// account's Statement will ever carry it, so it is recorded from the row
// itself (app/api/statement-rounds/[id]/cash/route.ts).
//
//   * cash — handed over at the office.
//   * internal — moved inside the cooperative, from the member's own
//     deposit account to the deduction they owe. 29401: ฿6,500 settled that
//     way, and the only button there was "บันทึกว่าจ่ายเงินสดแล้ว", which
//     would have filed it under 💵 เงินสด.
//
// Both are stored the same shape as a real transfer, so they count toward
// amountPaid through recomputeRoundPayments and can be corrected with the
// same เป็นเงินอะไร dropdown. account/branch are their own words rather than
// 413/447 so neither reads as belonging to a bank Statement file.

export type ManualPaymentMethod = "cash" | "internal";

export interface ManualPaymentShape {
  accountNumber: string;
  account: string;
  branch: string;
  description: string;
}

export const MANUAL_PAYMENT: Record<ManualPaymentMethod, ManualPaymentShape> = {
  cash: {
    accountNumber: "เงินสด",
    account: "cash",
    branch: "เงินสด",
    description: "ชำระเงินสดที่สำนักงาน",
  },
  internal: {
    accountNumber: "โอนภายใน",
    account: "internal",
    branch: "โอนภายใน",
    description: "โอนภายในสหกรณ์",
  },
};

// How each is named on its buttons, tags and errors.
export const MANUAL_PAYMENT_LABEL: Record<ManualPaymentMethod, string> = {
  cash: "เงินสด",
  internal: "โอนภายใน",
};

// Anything that is not asked for as "internal" is cash — the route took
// cash alone before, and older callers send no method at all.
export function parseManualPaymentMethod(value: unknown): ManualPaymentMethod {
  return value === "internal" ? "internal" : "cash";
}

// Rows no Statement upload produced, by the account they were stored under.
export function isManualPaymentAccount(account: string): boolean {
  return account === MANUAL_PAYMENT.cash.account || account === MANUAL_PAYMENT.internal.account;
}

// A branch staff wrote themselves: the member settled this round in person
// or by an internal transfer staff made for them.
export function isManualPaymentBranch(branch: string): boolean {
  return branch === MANUAL_PAYMENT.cash.branch || branch === MANUAL_PAYMENT.internal.branch;
}

// Which manual method a stored row came from, if any — for its tag.
export function manualPaymentMethodOf(t: {
  manualMemberNumber: boolean;
  accountNumber: string | null;
}): ManualPaymentMethod | null {
  if (!t.manualMemberNumber) return null;
  if (t.accountNumber === MANUAL_PAYMENT.cash.accountNumber) return "cash";
  if (t.accountNumber === MANUAL_PAYMENT.internal.accountNumber) return "internal";
  return null;
}
