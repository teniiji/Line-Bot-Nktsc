// A transaction filed from the เงินเข้าประจำวัน page as ชำระเก็บไม่ได้รายเดือน
// that never reached this round's own bookkeeping.
//
// canBridgeToRound (lib/roundReach.ts) only writes a StatementTransfer for a
// member the round still shows as owing, or still awaiting a result — a
// member it has already resolved (paid/overpaid/collected) has nothing here
// for a bank line to settle. That refusal is correct, but it left the
// เทียบ Statement page with nothing at all to show: 31132 had a ฿700
// recording, matched to their slip on the daily page, for a unit already
// taught their number — and their round row, already "✅ หักได้ครบ", opened
// on an empty transfer list with no sign the ฿700 had ever been seen.
//
// This is not about changing what counts — a resolved member stays resolved
// regardless. It only says, next to the member the round already agrees is
// settled, that a recording exists and when it was made, so staff are not
// left wondering whether the daily page's own "ตรงกับสลิป" was ever real.

import { coveredByRealTransfer, type RealTransferCandidate } from "./roundReach";

export interface RecordedLine {
  expenseId: string;
  memberNumber: string;
  amount: number;
  // The bank line's own timestamp where known — the daily page reads from
  // it — falling back to when the transaction was filed.
  postedAt: Date | null;
  createdAt: Date;
  // The bank line's own identity, for matching against a real transfer that
  // already covers it.
  lineFingerprint: string;
  senderAccount: string | null;
}

export interface RoundTransferRef extends RealTransferCandidate {
  fingerprint: string;
}

export interface UnbridgedRecording {
  id: string;
  memberNumber: string;
  amount: number;
  date: Date;
}

// A recording is already on screen the ordinary way when the round holds its
// line: bridged under "line:<fingerprint>" (see the record route), or loaded
// from an uploaded statement as the same account, amount and day.
export function unbridgedRecordings(
  recorded: RecordedLine[],
  roundTransfers: RoundTransferRef[]
): UnbridgedRecording[] {
  const fingerprints = new Set(roundTransfers.map((t) => t.fingerprint));
  return recorded
    .filter((r) => !fingerprints.has(`line:${r.lineFingerprint}`))
    .filter(
      (r) =>
        !(
          r.senderAccount &&
          r.postedAt &&
          coveredByRealTransfer(roundTransfers, r.senderAccount, r.amount, r.postedAt)
        )
    )
    .map((r) => ({
      id: `expense:${r.expenseId}`,
      memberNumber: r.memberNumber,
      amount: Math.round(r.amount * 100) / 100,
      date: r.postedAt ?? r.createdAt,
    }));
}
