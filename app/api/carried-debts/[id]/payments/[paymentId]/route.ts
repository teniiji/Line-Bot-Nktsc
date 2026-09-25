import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ROUND_CLOSED_ERROR, frozenByClosedRound } from "@/lib/carriedDebt";
import { recomputeCarriedDebt, syncTransferCarried } from "@/lib/carriedDebtStore";
import { recomputeRoundPayments } from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// Takes a payment back off a carried debt — a slip, a wrong debt chosen.
// A transfer's share goes back to counting in the round it came from.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; paymentId: string } }
) {
  const payment = await prisma.carriedDebtPayment.findFirst({
    where: { id: params.paymentId, debtId: params.id },
  });
  if (!payment) {
    return NextResponse.json({ error: "ไม่พบรายการชำระนี้" }, { status: 404 });
  }

  // Handing the money back would change a round that has since been closed
  // — its carried debts were taken from the figures this would move. Unless
  // the round counts that line for nobody, when nothing there moves.
  let roundClosed = false;
  if (payment.roundId) {
    const round = await prisma.statementRound.findUnique({
      where: { id: payment.roundId },
      select: { closedAt: true },
    });
    roundClosed = !!round?.closedAt;
    const line = payment.fingerprint
      ? await prisma.statementTransfer.findFirst({
          where: { roundId: payment.roundId, fingerprint: payment.fingerprint },
          select: { memberNumber: true },
        })
      : null;
    if (frozenByClosedRound(roundClosed, line ? line.memberNumber : "unknown")) {
      return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });
    }
  }

  await prisma.carriedDebtPayment.delete({ where: { id: payment.id } });
  await recomputeCarriedDebt(payment.debtId);
  if (payment.roundId && payment.fingerprint) {
    await syncTransferCarried(payment.roundId, payment.fingerprint);
    if (!roundClosed) await recomputeRoundPayments(payment.roundId);
  }

  return NextResponse.json({ ok: true });
}
