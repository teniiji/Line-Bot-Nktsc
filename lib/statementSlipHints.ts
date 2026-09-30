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

// The reason a transfer is set aside because it settles a different month —
// named so the round view can offer it directly on a line it has found
// counting in more than one round. See lib/roundDoubleCount.ts.
export const OTHER_ROUND_REASON = "ชำระของรอบอื่น";

// The purposes a transfer can be set aside under: the bot's own transaction
// categories minus the deduction payment itself, plus a catch-all. A fixed
// list rather than free text, so the reason on a row is something the next
// person can read and act on. Lives here rather than in the route because a
// Next.js route file may only export request handlers.
// The money the results file already counts: a member it lists as หักได้ครบ
// who transferred part of it themselves before the unit reported (22730:
// ฿2,000 of a ฿16,111 deduction), where the transfer is the settling, not
// money on top of it. Left out of what they paid, like any other reason.
export const IN_RESULT_REASON = "รวมอยู่ในผลการหักแล้ว";

// How a reason reads in the "เป็นเงินอะไร" choices: the reason itself —
// "ซื้อหุ้น" already says what the money was for, and a "ไม่เกี่ยวกับรอบนี้ —"
// in front of every choice only made the list harder to read. The one that
// says the round has already counted the money is marked apart.
export function excludeReasonLabel(reason: string): string {
  return reason === IN_RESULT_REASON ? `✅ ${reason}` : reason;
}

export const EXCLUDE_REASONS = [
  IN_RESULT_REASON,
  "ซื้อหุ้น",
  "ชำระหนี้",
  "ฝากเงิน",
  "ชำระประกัน",
  "ชำระฌาปนกิจ",
  // The funeral-welfare associations members pay into alongside the
  // deduction — most often cut out of a transfer in part (lib/transferSetAside.ts).
  "สสค",
  "สสอค",
  "สสชสอ",
  "สสสก",
  "สสสท",
  // Not a purpose like the ones above: this money really was a deduction
  // payment, just not this round's. A round counts whatever statement was
  // uploaded into it, and nothing on a transfer says which month it was
  // meant for — so a September export loaded into August to catch the late
  // payers, or a member who owes two months and transfers once, both end up
  // counting in a round they do not settle. Until now the only way to set one
  // aside was "อื่นๆ", which three months later reads as nobody knowing why.
  OTHER_ROUND_REASON,
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

// Where the hint above is strong enough to act on: the member's own slip for
// the same amount, sent the day the money arrived (or the day either side),
// under a purpose the round sets aside. 21730 sent a slip for ฿400,000 as
// ฝากเงิน on 25 ก.ย., the bank line landed 25 ก.ย. 13:11, and staff still
// had to tell the round what the member had already told the bot. Only the
// purposes a member files through the bot are taken this way — never the
// round's own reasons (already counted, another round, อื่นๆ).
const SLIP_DAY_WINDOW_MS = DAY_MS;
const ROUND_ONLY_REASONS = new Set([IN_RESULT_REASON, OTHER_ROUND_REASON, "อื่นๆ"]);

export function autoSlipReasons(
  transfers: TransferForHint[],
  slips: SlipRecord[]
): Map<string, string> {
  const out = new Map<string, string>();
  const hints = matchSlipHints(transfers, slips);
  const byId = new Map(transfers.map((t) => [t.id, t]));
  for (const [id, hint] of hints) {
    const t = byId.get(id);
    if (!t?.transferredAt) continue;
    if (!EXCLUDE_REASONS.includes(hint.category) || ROUND_ONLY_REASONS.has(hint.category)) continue;
    if (Math.abs(t.transferredAt.getTime() - new Date(hint.date).getTime()) > SLIP_DAY_WINDOW_MS) continue;
    out.set(id, hint.category);
  }
  return out;
}
