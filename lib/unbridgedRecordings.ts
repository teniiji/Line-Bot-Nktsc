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
  lineId: string;
  // How much of the line already pays carried debts (ชำระข้ามเดือน).
  carried: number;
}

export interface RoundTransferRef extends RealTransferCandidate {
  fingerprint: string;
}

export interface UnbridgedRecording {
  id: string;
  memberNumber: string;
  amount: number;
  date: Date;
  lineId: string;
  carried: number;
  // What is left of the line for a carried debt to take.
  available: number;
  // No paying account on the line: a unit's office sending money on for its
  // people (lib/unitPayer.ts), not the member transferring it themselves.
  fromUnit: boolean;
  // Set for a payment whose bank date falls in another month (its MMYY
  // code) — see otherMonthRecordings.
  otherPeriod?: string;
  // The round that counts it already, by label; null when none does.
  countedIn?: string | null;
  // One member's share of a unit's lump transfer divided on the daily page
  // (lib/splitSharesOutside.ts) rather than a whole line recorded for them.
  splitShare?: { payerName: string | null; lineAmount: number; memberNumber: string };
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
      lineId: r.lineId,
      carried: Math.round(r.carried * 100) / 100,
      available: Math.max(0, Math.round((r.amount - r.carried) * 100) / 100),
      fromUnit: !r.senderAccount,
    }));
}

// This member's recordings whose money landed in another month. The month
// rule (periodOfDate) sends each to that month's round, so the round being
// looked at never listed them — 27591: ฿3,200 filed as ชำระเก็บไม่ได้รายเดือน
// and matched to their slip, while their round row sat on ❌ ยังค้าง with
// an empty transfer list and nothing to say where the money had gone. When
// that month has no round, or the member is not on it, nothing counts it at
// all; this lists it with where it stands, so staff can count it here.
export function otherMonthRecordings(
  recorded: (RecordedLine & { period: string })[],
  // Rounds that already hold a line: bridged under "line:<fingerprint>".
  bridged: { fingerprint: string; roundLabel: string }[],
  // Real statement transfers in any round, for the same line uploaded there.
  realTransfers: (RoundTransferRef & { roundLabel: string })[]
): UnbridgedRecording[] {
  const bridgedIn = new Map(bridged.map((b) => [b.fingerprint, b.roundLabel]));
  return recorded.map((r) => {
    const covering =
      r.senderAccount && r.postedAt
        ? realTransfers.find((t) => coveredByRealTransfer([t], r.senderAccount as string, r.amount, r.postedAt as Date))
        : undefined;
    const countedIn = bridgedIn.get(`line:${r.lineFingerprint}`) ?? covering?.roundLabel ?? null;
    return {
      id: `expense:${r.expenseId}`,
      memberNumber: r.memberNumber,
      amount: Math.round(r.amount * 100) / 100,
      date: r.postedAt ?? r.createdAt,
      lineId: r.lineId,
      carried: Math.round(r.carried * 100) / 100,
      // Counted by another round, none of it is free for a debt here.
      available: countedIn ? 0 : Math.max(0, Math.round((r.amount - r.carried) * 100) / 100),
      fromUnit: !r.senderAccount,
      otherPeriod: r.period,
      countedIn,
    };
  });
}

// A unit's transfer for a member the round already has as หักได้ครบ is that
// deduction arriving: the office took it from their pay and passed it on.
// It is the round's own money, not a second payment — so it is neither
// "ไม่นับในรอบนี้" nor something an earlier month's debt may take. 29457:
// ฿19,320 from Udon Thani PES, the same money the results file had already
// marked collected. (A member's own transfer is different — that is money
// beyond what payroll took, and may well be paying an older month.)
export function isCollectedRemittance(
  recording: { fromUnit: boolean },
  deductionResult: string
): boolean {
  return recording.fromUnit && deductionResult === "collected";
}
