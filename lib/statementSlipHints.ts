// Layer 2 of telling apart money paid toward a failed deduction from money
// sent for something else.
//
// A bank statement line says an account transferred an amount and nothing
// about what for. The bot, though, already asks: a member who sends a slip
// picks a หมวดหมู่, and that lands in Expense with their member number, the
// amount and the date. So when a transfer lines up with a slip the member
// filed under ซื้อหุ้น (or ชำระหนี้, ฝากเงิน …), that is a strong sign this
// money was never meant to settle their deduction.
//
// This only ever produces a hint for staff to look at. It never excludes
// anything on its own: matching on amount and date is a guess, and wrongly
// discounting a real payment means chasing somebody who has already paid,
// which is worse than the problem it would be solving.

// The one category that *is* a deduction payment — a slip filed under this
// confirms the transfer rather than casting doubt on it.
export const DEDUCTION_CATEGORY = "ชำระเก็บไม่ได้รายเดือน";

// The purposes a transfer can be set aside under: the bot's own transaction
// categories minus the deduction payment itself, plus a catch-all. A fixed
// list rather than free text, so the reason on a row is something the next
// person can read and act on. Lives here rather than in the route because a
// Next.js route file may only export request handlers.
export const EXCLUDE_REASONS = [
  "ซื้อหุ้น",
  "ชำระหนี้",
  "ฝากเงิน",
  "ชำระประกัน",
  "ชำระฌาปนกิจ",
  "อื่นๆ",
];

// A slip is dated when the member sent it, the statement when the bank
// posted it; a few days apart is normal, and the window stays small so a
// member's monthly habit of transferring the same amount does not match
// every month at once.
const DATE_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SlipRecord {
  memberNumber: string;
  amount: number;
  date: Date;
  category: string;
  description?: string | null;
}

export interface TransferForHint {
  id: string;
  memberNumber: string | null;
  amount: number;
  transferredAt: Date | null;
}

export interface SlipHint {
  category: string;
  amount: number;
  date: string;
}

function sameAmount(a: number, b: number): boolean {
  // A slip and its statement line are the same payment, so the amounts should
  // be equal outright — a tolerance here would start matching a member's
  // other transfers instead.
  return Math.abs(a - b) < 0.01;
}

function withinWindow(a: Date | null, b: Date): boolean {
  // A transfer with no readable date can still be hinted on member and
  // amount; that is weaker, but it is a hint, not a decision.
  if (!a) return true;
  return Math.abs(a.getTime() - b.getTime()) <= DATE_WINDOW_DAYS * DAY_MS;
}

// Pairs transfers with slips the member filed under some other purpose.
// Each slip is used at most once, so a member with two identical transfers
// and one matching slip gets one hint, not two.
export function matchSlipHints(
  transfers: TransferForHint[],
  slips: SlipRecord[]
): Map<string, SlipHint> {
  const hints = new Map<string, SlipHint>();
  const used = new Set<SlipRecord>();

  const byMember = new Map<string, SlipRecord[]>();
  for (const slip of slips) {
    if (slip.category === DEDUCTION_CATEGORY) continue;
    const list = byMember.get(slip.memberNumber) ?? [];
    list.push(slip);
    byMember.set(slip.memberNumber, list);
  }

  for (const transfer of transfers) {
    if (!transfer.memberNumber) continue;
    const candidates = byMember.get(transfer.memberNumber);
    if (!candidates) continue;

    const slip = candidates.find(
      (s) => !used.has(s) && sameAmount(s.amount, transfer.amount) && withinWindow(transfer.transferredAt, s.date)
    );
    if (!slip) continue;

    used.add(slip);
    hints.set(transfer.id, {
      category: slip.category,
      amount: slip.amount,
      date: slip.date.toISOString(),
    });
  }

  return hints;
}
