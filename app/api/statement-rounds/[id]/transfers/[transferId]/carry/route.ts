import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ROUND_CLOSED_ERROR,
  carryAmountProblem,
  countedAmount,
  frozenByClosedRound,
} from "@/lib/carriedDebt";
import { recomputeCarriedDebt, syncTransferCarried } from "@/lib/carriedDebtStore";
import { recomputeRoundPayments } from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// Takes some or all of one transfer out of the open round it arrived in and
// puts it toward a carried debt (ชำระข้ามเดือน) instead — a September
// transfer that was really paying August.
//
// Staff choose which debt, every time: the cooperative has no rule that
// money pays the oldest month first, and a member can owe this round and an
// earlier one at once. The round page only points out that an earlier debt
// exists.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; transferId: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
  const transfer = await prisma.statementTransfer.findFirst({
    where: { id: params.transferId, roundId: round.id },
  });
  if (!transfer) {
    return NextResponse.json({ error: "ไม่พบรายการโอนนี้ในรอบนี้" }, { status: 404 });
  }
  if (frozenByClosedRound(!!round.closedAt, transfer.memberNumber)) {
    return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });
  }
  // Money already set aside as ซื้อหุ้น and the like is not this round's to
  // give away; put it back first if it was really a debt payment.
  if (transfer.excludedReason) {
    return NextResponse.json(
      { error: `รายการนี้ระบุไว้ว่าเป็น "${transfer.excludedReason}" — เปลี่ยนกลับเป็นนับเป็นจ่ายค่าหักไม่ได้ก่อน` },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const debtId = String(body.debtId ?? "").trim();
  const debt = debtId ? await prisma.carriedDebt.findUnique({ where: { id: debtId } }) : null;
  if (!debt) {
    return NextResponse.json({ error: "ต้องเลือกหนี้ข้ามเดือนที่จะชำระ" }, { status: 400 });
  }

  const available = countedAmount(transfer);
  // Defaults to everything the line still has in this round.
  const amount = body.amount === undefined || body.amount === "" ? available : Number(body.amount);
  const problem = carryAmountProblem(available, amount);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  await prisma.carriedDebtPayment.create({
    data: {
      debtId: debt.id,
      amount,
      paidAt: transfer.transferredAt ?? new Date(),
      method: "transfer",
      roundId: round.id,
      fingerprint: transfer.fingerprint,
      accountNumber: transfer.accountNumber,
    },
  });
  await syncTransferCarried(round.id, transfer.fingerprint);
  if (!round.closedAt) await recomputeRoundPayments(round.id);
  await recomputeCarriedDebt(debt.id);

  return NextResponse.json({ ok: true, debtId: debt.id, amount });
}
