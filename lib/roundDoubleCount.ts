// One transfer settling two months at once.
//
// A round counts whatever statement was uploaded into it. Nothing compares a
// transfer's date with the round's month — deliberately, because that is what
// makes the ordinary case work: September's export is loaded into the August
// round to catch the members who paid late, and their money settles August.
//
// The same freedom is what lets one payment count twice. StatementTransfer is
// unique on [roundId, fingerprint], so the same bank line under two rounds is
// two rows, each counting in full. Load September's export into both the
// August round (for the late payers) and the September round (for the current
// one) — the obvious thing to do — and every member who paid in September is
// now marked as having settled both months, on one transfer.
//
// Nothing about the data says which month the member meant, so this does not
// decide. It finds the lines that are being counted more than once and says
// so, and the round view offers "ชำระของรอบอื่น" on them: a person who knows
// what the payment was for sets it aside in the round it does not settle.

export interface RoundTransfer {
  id: string;
  fingerprint: string;
  // Whether this row is actually adding to somebody's amountPaid — matched to
  // a member and not already set aside. See recomputeRoundPayments.
  counts: boolean;
}

export interface ElsewhereTransfer {
  fingerprint: string;
  // The other round's label, as staff read it: "ส.ค. 2569".
  label: string;
  counts: boolean;
}

// Which other rounds are counting each of this round's transfers.
//
// Only where both sides count. A line already set aside in one of the two is
// settling one month and sitting in the other doing nothing, which is exactly
// the state this is meant to get people to — flagging it then would be
// telling somebody off for having fixed it.
export function countedElsewhere(
  mine: RoundTransfer[],
  elsewhere: ElsewhereTransfer[]
): Map<string, string[]> {
  const labelsByFingerprint = new Map<string, Set<string>>();
  for (const other of elsewhere) {
    if (!other.counts) continue;
    const labels = labelsByFingerprint.get(other.fingerprint) ?? new Set<string>();
    labels.add(other.label);
    labelsByFingerprint.set(other.fingerprint, labels);
  }

  const found = new Map<string, string[]>();
  for (const transfer of mine) {
    if (!transfer.counts) continue;
    const labels = labelsByFingerprint.get(transfer.fingerprint);
    if (labels && labels.size > 0) {
      found.set(transfer.id, [...labels].sort((a, b) => a.localeCompare(b, "th")));
    }
  }
  return found;
}

// What a flagged line says on screen. Names the other rounds, because the
// question it raises — which month was this for? — cannot be answered without
// knowing what it is competing with.
export function describeDoubleCount(labels: string[]): string {
  return `นับในรอบ ${labels.join(" และ ")} ด้วย`;
}
