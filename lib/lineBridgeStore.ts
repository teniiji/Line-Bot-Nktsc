import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { canBridgeToRound, coveredByRealTransfer } from "@/lib/roundReach";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { adoptLinePayments } from "@/lib/carriedDebtStore";
import { periodOfDate } from "@/lib/deductionPeriod";

// Writes a bank line recorded on the เงินเข้าประจำวัน page as this member's
// deduction into the หักไม่ได้ round for the month the money arrived in — the
// same fact the round's own statement upload would have established, learned
// by phone instead of by file.
//
// The round is the one whose MMYY code the payment's own date falls in
// (periodOfDate), never just "whichever round is newest": with August and
// September both open, "newest" once turned an August payment into a
// September overpayment. A closed round's month has become carried debt and
// is placed on the ชำระข้ามเดือน tab by a person instead.
//
// Used when the line is recorded, and again later from the round page when
// the round has since come to agree the member owes — 29375: ฿31,560 from
// Pathumthani 2 recorded while their result was still pending, then the
// results file marked them หักไม่ได้, and nothing put the money back in.

export interface BridgeableLine {
  fingerprint: string;
  senderAccount: string | null;
  amount: number;
  postedAt: Date | null;
  account: string;
  branch: string;
  description: string;
  sourceFile: string | null;
}

export type BridgeOutcome =
  | { bridged: true; round: { id: string; period: string; label: string } }
  | { bridged: false; reason: string };

export async function bridgeLineToRound(
  line: BridgeableLine,
  memberNumber: string,
  // What to count: the line's amount, less anything set aside from its
  // recording under another category (lib/recordingAside.ts).
  amount: number = line.amount
): Promise<BridgeOutcome> {
  // A line that names no account — a unit's remittance, cash paid in at the
  // counter — is still this member's deduction paid: staff chose the member
  // when recording it. The round's own uploads only ever read "TR fr" lines,
  // which always name one, so there is no file copy for it to double. 14801:
  // ฿16,160 paid in with no account on it was turned away here while the
  // round still showed them waiting on ฿15,740.
  if (!line.postedAt) return { bridged: false, reason: "บรรทัดนี้ไม่มีวันที่โอน" };

  const round = await prisma.statementRound.findUnique({
    where: { period: periodOfDate(line.postedAt) },
    select: { id: true, period: true, label: true, closedAt: true },
  });
  if (!round) return { bridged: false, reason: "ยังไม่มีรอบของเดือนที่โอน" };
  if (round.closedAt) {
    return { bridged: false, reason: `รอบ ${round.label} ปิดแล้ว — ใช้ชำระที่แถบ "ชำระข้ามเดือน" แทน` };
  }

  const fingerprint = `line:${line.fingerprint}`;
  const already = await prisma.statementTransfer.findFirst({
    where: { roundId: round.id, fingerprint },
    select: { id: true },
  });
  if (already) return { bridged: false, reason: `ยอดนี้นับอยู่ในรอบ ${round.label} แล้ว` };

  const key = memberNumberKey(memberNumber);
  const onRound = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: { memberNumber: true, deductionResult: true, status: true },
  });
  const member = onRound.find((m) => memberNumberKey(m.memberNumber) === key) ?? null;
  if (!member) return { bridged: false, reason: `สมาชิกคนนี้ไม่อยู่ในรอบ ${round.label}` };
  if (!canBridgeToRound(member)) {
    return { bridged: false, reason: "สมาชิกคนนี้ครบในรอบนี้แล้ว ไม่ต้องนับเพิ่ม" };
  }

  // A member still showing "unpaid" only means the round has not seen enough
  // money yet. If its own statement already carries a real transfer for the
  // same account, amount and day, this line is that transfer read a second
  // way, and writing it again would double it.
  if (line.senderAccount) {
    const realTransfers = await prisma.statementTransfer.findMany({
      where: { roundId: round.id, accountNumber: line.senderAccount, amount: line.amount, manualMemberNumber: false },
      select: { accountNumber: true, amount: true, transferredAt: true },
    });
    if (coveredByRealTransfer(realTransfers, line.senderAccount, line.amount, line.postedAt)) {
      return { bridged: false, reason: "ยอดนี้อยู่ใน Statement ที่อัปเข้ารอบแล้ว" };
    }
  }

  await prisma.statementTransfer.create({
    data: {
      roundId: round.id,
      memberNumber: member.memberNumber,
      accountNumber: line.senderAccount ?? "",
      amount: Math.round(amount * 100) / 100,
      transferredAt: line.postedAt,
      account: line.account,
      branch: line.branch,
      description: line.description,
      // Traceable back to the line it came from, and never mistaken for a
      // fingerprint a real statement upload could also produce.
      fingerprint,
      sourceFile: line.sourceFile,
      manualMemberNumber: true,
    },
  });
  // Part of this line may already pay a carried debt (taken from the daily
  // page while no round held it); the round leaves that out.
  await adoptLinePayments(round.id);
  await recomputeRoundPayments(round.id);
  return { bridged: true, round: { id: round.id, period: round.period, label: round.label } };
}
