// Finding the money for a carried debt (ชำระข้ามเดือน) when it did not come
// from the debtor's own account: another member transferring on their behalf
// (11313 ชูศักดิ์ ฿18,000 for someone else's earlier month). The candidates
// list only reads accounts the debtor is known to pay from, so this money
// never appears there; staff search for it by what they know — the amount on
// the slip, or the account it came from.

export type DebtPaymentQuery = { amount: number } | { account: string };

// "18000", "18,000", "18000.00" → an amount. Six or more digits with no
// decimal point → an account number (no carried debt runs to ฿100,000).
export function parseDebtPaymentQuery(raw: string): DebtPaymentQuery | null {
  const text = raw.replace(/[,\s฿]/g, "").replace(/-/g, "");
  if (!text) return null;
  if (/^\d{6,}$/.test(text)) return { account: text };
  if (/^\d+(\.\d{1,2})?$/.test(text)) {
    const amount = Number(text);
    return amount > 0 ? { amount } : null;
  }
  return null;
}

export interface DebtPaymentSource {
  // "transfer": a row in an open round, taken through its carry route.
  // "line": a daily-page line no round holds, through from-line.
  kind: "transfer" | "line";
  id: string;
  roundId: string | null;
  roundLabel: string | null;
  // Whom the money counts for now, if anyone.
  memberNumber: string | null;
  memberName: string | null;
  accountNumber: string | null;
  description: string | null;
  amount: number;
  date: string | null;
  // What is left of it for a debt.
  available: number;
}

// Newest first, the ones with something left to give first of all.
export function sortSources(sources: DebtPaymentSource[]): DebtPaymentSource[] {
  return [...sources].sort(
    (a, b) =>
      Number(b.available > 0.005) - Number(a.available > 0.005) ||
      (b.date ?? "").localeCompare(a.date ?? "")
  );
}
