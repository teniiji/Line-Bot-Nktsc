import { splitFingerprint } from "./unitPayer";
import { periodOfDate } from "./deductionPeriod";
import type { UnbridgedRecording } from "./unbridgedRecordings";

// A share of a unit's lump transfer, divided on the เงินเข้าประจำวัน page
// (lib/lineSplitStore.ts), that this round does not hold. Dividing places
// each share in the open round for the month the money arrived — and only
// for members already on it. 23321: their share of a เขต transfer went
// nowhere, because that month's round did not have them (or did not exist),
// and their row here read ❌ ยังค้าง ฿7,400 with no sign the money had come.
//
// Listed beside the member's transfers the same way a whole recording from
// another month is (otherMonthRecordings), so staff see where it stands and
// can count it here.

export interface SplitShare {
  splitId: string;
  lineId: string;
  lineFingerprint: string;
  // As written on the division; the round row's fingerprint is built from it.
  memberNumber: string;
  // The round's own spelling of the member.
  roundMemberNumber: string;
  amount: number;
  postedAt: Date | null;
  createdAt: Date;
  payerName: string | null;
  lineAmount: number;
}

export function splitSharesOutside(
  shares: SplitShare[],
  // Round rows already holding a share, by fingerprint.
  placed: { fingerprint: string; roundId: string }[],
  roundId: string,
  roundLabel: (id: string) => string
): UnbridgedRecording[] {
  const placedIn = new Map(placed.map((p) => [p.fingerprint, p.roundId]));
  return shares.flatMap((s) => {
    const holder = placedIn.get(splitFingerprint(s.lineFingerprint, s.memberNumber));
    if (holder === roundId) return [];
    const date = s.postedAt ?? s.createdAt;
    return [
      {
        id: `split:${s.splitId}`,
        memberNumber: s.roundMemberNumber,
        amount: Math.round(s.amount * 100) / 100,
        date,
        lineId: s.lineId,
        carried: 0,
        // A share is never taken for a carried debt from here: that takes
        // from the whole line, not one member's part of it.
        available: 0,
        fromUnit: true,
        otherPeriod: periodOfDate(date),
        countedIn: holder ? roundLabel(holder) : null,
        splitShare: {
          payerName: s.payerName,
          lineAmount: Math.round(s.lineAmount * 100) / 100,
          memberNumber: s.memberNumber,
        },
      },
    ];
  });
}
