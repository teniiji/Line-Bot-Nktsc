import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINE_FINGERPRINT_PREFIX, carryAmountProblem } from "@/lib/carriedDebt";
import { recomputeCarriedDebt } from "@/lib/carriedDebtStore";
import { isMemberDeposit } from "@/lib/statementLines";
import { coveredByRealTransfer } from "@/lib/roundReach";

export const dynamic = "force-dynamic";

// Pays a carried debt from a bank line on the เงินเข้าประจำวัน page that no
// round holds. A round only sees the statement files uploaded into it, so a
// debtor's payment can be on the daily page and in no round at all — and
// money no round received, no round is counting.
//
// Keyed by the line's own fingerprint with no round. If a round receives the
// same line later, by upload or by the daily page's bridge, the payment moves
// onto that row (adoptLinePayments) and the round leaves the money out.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const debt = await prisma.carriedDebt.findUnique({ where: { id: params.id } });
  if (!debt) {
    return NextResponse.json({ error: "ไม่พบหนี้รายการนี้" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const line = await prisma.statementLine.findUnique({ where: { id: String(body.lineId ?? "") } });
  // No paying account is fine: a unit's payroll office paying for a member
  // (BSD02 "…/เทศบาล…") names none, and is found through the member's slip.
  if (!line || !isMemberDeposit(line.channel) || line.amount <= 0) {
    return NextResponse.json({ error: "ไม่พบรายการเงินเข้านี้" }, { status: 404 });
  }

  // Once a round holds the line, the money is that round's to give — from
  // its own transfer row, where the round can leave it out of its count.
  const lineKey = `${LINE_FINGERPRINT_PREFIX}${line.fingerprint}`;
  const inRounds = await prisma.statementTransfer.findMany({
    where: {
      OR: [
        { fingerprint: lineKey },
        ...(line.senderAccount ? [{ accountNumber: line.senderAccount, amount: line.amount }] : []),
      ],
    },
    select: { roundId: true, fingerprint: true, accountNumber: true, amount: true, transferredAt: true },
  });
  const held = inRounds.find(
    (t) =>
      t.fingerprint === lineKey ||
      (line.senderAccount !== null &&
        line.postedAt !== null &&
        coveredByRealTransfer([t], line.senderAccount, line.amount, line.postedAt))
  );
  if (held) {
    const round = await prisma.statementRound.findUnique({
      where: { id: held.roundId },
      select: { label: true },
    });
    return NextResponse.json(
      {
        error: `ยอดนี้อยู่ในรอบ ${round?.label ?? ""} แล้ว — กด "ตรวจอีกครั้ง" แล้วใช้จากรายการในรอบนั้น`,
      },
      { status: 409 }
    );
  }

  const used = await prisma.carriedDebtPayment.aggregate({
    where: { roundId: null, fingerprint: lineKey },
    _sum: { amount: true },
  });
  const available = Math.round((line.amount - (used._sum.amount ?? 0)) * 100) / 100;
  const amount = body.amount === undefined || body.amount === "" ? available : Number(body.amount);
  const problem = carryAmountProblem(available, amount);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  await prisma.carriedDebtPayment.create({
    data: {
      debtId: debt.id,
      amount,
      paidAt: line.postedAt ?? new Date(),
      method: "transfer",
      roundId: null,
      fingerprint: lineKey,
      accountNumber: line.senderAccount,
      note: null,
    },
  });
  await recomputeCarriedDebt(debt.id);

  return NextResponse.json({ ok: true, debtId: debt.id, amount });
}
