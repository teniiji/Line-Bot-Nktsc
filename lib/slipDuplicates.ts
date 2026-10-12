import { sameMember } from "./memberNumber";

// A slip with no money behind it that is most likely the same payment filed
// twice. 900539: one ฿30,000 ซื้อหุ้น came in at 09:46 and paired with the
// member's slip, and a second ฿30,000 ซื้อหุ้น for the same member and day —
// no picture, no account, typed in again by hand — sat under "มีสลิปแต่ไม่เจอ
// เงินเข้า" looking like money that never arrived. Pairing is one slip per
// line (lib/dailyReconcile.ts), so the second can never pair, and nothing
// on screen said why.
//
// A hint, not a verdict: a member can pay the same amount twice in a day, and
// the second transfer may simply be in a statement not uploaded yet. Staff
// decide; the page offers to delete it.

export interface SlipLike {
  id: string;
  amount: number;
  date: Date;
  memberNumber: string | null;
  category: string | null;
}

export interface DuplicateHint {
  // The slip this one repeats.
  ofSlipId: string;
  // True when that slip already paired with a bank line, so this one is the
  // spare; false when both are still waiting and this is the later of the two.
  matched: boolean;
  // The bank line's posting, when it paired with one.
  postedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Same reading of a day as the pairing uses — see dayOf in lib/dailyReconcile.ts.
const dayOf = (date: Date) => Math.floor(date.getTime() / DAY_MS);

// The same payment, as far as two records can tell: one member, one amount,
// one day, and what it was for agrees — a missing category does not count
// against it, since a hand-typed record may leave it blank.
function samePayment(a: SlipLike, b: SlipLike): boolean {
  return (
    sameMember(a.memberNumber, b.memberNumber) &&
    Math.abs(a.amount - b.amount) < 0.01 &&
    dayOf(a.date) === dayOf(b.date) &&
    (!a.category || !b.category || a.category === b.category)
  );
}

export function likelyDuplicates(
  unclaimed: SlipLike[],
  claimed: { slip: SlipLike; postedAt: Date | null }[]
): Map<string, DuplicateHint> {
  const hints = new Map<string, DuplicateHint>();
  // Each paired slip explains one spare at most: two spares beside one paired
  // slip means a third payment somebody still has to look for.
  const usedClaimed = new Set<string>();
  for (const slip of unclaimed) {
    const twin = claimed.find((c) => !usedClaimed.has(c.slip.id) && samePayment(slip, c.slip));
    if (twin) {
      usedClaimed.add(twin.slip.id);
      hints.set(slip.id, { ofSlipId: twin.slip.id, matched: true, postedAt: twin.postedAt });
    }
  }
  // Two waiting copies of one payment: the later is the hint, the first stays
  // as the one that may yet find its money.
  const firsts: SlipLike[] = [];
  for (const slip of [...unclaimed].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    // A spare already explained still counts as a copy a later one repeats.
    if (hints.has(slip.id)) {
      firsts.push(slip);
      continue;
    }
    const earlier = firsts.find((f) => samePayment(slip, f));
    if (earlier) hints.set(slip.id, { ofSlipId: earlier.id, matched: false, postedAt: null });
    else firsts.push(slip);
  }
  return hints;
}
