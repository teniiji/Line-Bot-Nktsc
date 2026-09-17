// Telling "nobody knows whose this is" apart from "we know, and it is not
// this round's business".
//
// Staff work the "โอนเข้ามาแต่ไม่พบเจ้าของ" list one row at a time: read the
// account, find the member, press ระบุเจ้าของ. The binding is saved to the
// account directory and used by every future round and by the daily page —
// but the round itself only credits members on its own หักไม่ได้ list, and
// somebody who owed nothing this month is not on it. So the transfer stays
// unmatched, the row stays exactly where it was, and the list still says 383.
//
// The save worked. The list was lying about it. A row whose owner is written
// down is not a row with no owner, and leaving it under that heading means
// the work never visibly ends and the same account gets looked up again next
// week by somebody who cannot tell it has been done.
//
// Nothing about the arithmetic changes: the money still does not count toward
// a round the member owes nothing in — there is no row of theirs to settle —
// and the separated list says so in as many words.
//
// One binding does not leave the list: a member number that appears in no
// list at all, neither this round nor the member register. That is the shape
// of a typo, and a typo is not knowledge — moving it out would file the money
// under a member who may not exist and take the row off the only list anybody
// looks at. It stays where it is, carrying the number so the row itself can
// ask whether it was typed correctly.

export interface BoundOwner {
  memberNumber: string;
  memberName: string | null;
  // Whether this member number is in the member register. False means nobody
  // by that number is known to exist.
  inRoster: boolean;
}

export interface SplitTransfers<T> {
  // Still to do: nobody's, or claimed by a number nobody recognises.
  unknown: (T & { boundTo: BoundOwner | null })[];
  // Owner known, but not on this round's list.
  outsideRound: (T & { boundTo: BoundOwner })[];
}

// Splits the round's unmatched transfers by whether the directory knows the
// paying account.
//
// A transfer whose account is bound to somebody on this round's list is not
// unmatched in the first place — the rematch will have credited it — so every
// binding found here is by definition a member the round has no row for.
export function splitByBinding<T extends { accountNumber: string }>(
  rows: T[],
  owners: Map<string, BoundOwner>
): SplitTransfers<T> {
  const unknown: (T & { boundTo: BoundOwner | null })[] = [];
  const outsideRound: (T & { boundTo: BoundOwner })[] = [];

  for (const row of rows) {
    const boundTo = owners.get(row.accountNumber) ?? null;
    if (boundTo && boundTo.inRoster) outsideRound.push({ ...row, boundTo });
    else unknown.push({ ...row, boundTo });
  }

  return { unknown, outsideRound };
}
