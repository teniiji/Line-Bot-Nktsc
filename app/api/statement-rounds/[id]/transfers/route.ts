import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { EXCLUDE_REASONS } from "@/lib/statementSlipHints";
import { ROUND_CLOSED_ERROR } from "@/lib/carriedDebt";

export const dynamic = "force-dynamic";

// Marks one transfer as being for something other than this round's failed
// deductions, or puts it back. A statement never says what money was for, so
// this is the only way the distinction can be recorded — and it matters both
// directions: leaving ซื้อหุ้น money counted makes a member look settled when
// they still owe, and wrongly setting aside a real payment sends staff after
// somebody who has already paid.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const transferId = String(body.transferId ?? "").trim();
  const raw = body.excludedReason;

  if (!transferId) {
    return NextResponse.json({ error: "ต้องระบุรายการโอน" }, { status: 400 });
  }

  // null puts the money back into the reconciliation.
  const excludedReason = raw === null || raw === undefined ? null : String(raw).trim();
  if (excludedReason !== null && !EXCLUDE_REASONS.includes(excludedReason)) {
    return NextResponse.json(
      { error: `เหตุผลต้องเป็นหนึ่งใน: ${EXCLUDE_REASONS.join(", ")}` },
      { status: 400 }
    );
  }

  const round = await prisma.statementRound.findUnique({
    where: { id: params.id },
    select: { closedAt: true },
  });
  if (round?.closedAt) {
    return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });
  }

  const transfer = await prisma.statementTransfer.findFirst({
    where: { id: transferId, roundId: params.id },
    select: { id: true, carriedAmount: true },
  });
  if (!transfer) {
    return NextResponse.json({ error: "ไม่พบรายการโอนนี้ในรอบนี้" }, { status: 404 });
  }
  // Part of this line already pays a carried debt; setting it aside as
  // ซื้อหุ้น and the like as well would put the same money in two places.
  // The carried payment has to be taken back on the ชำระข้ามเดือน tab first.
  if (excludedReason !== null && transfer.carriedAmount > 0) {
    return NextResponse.json(
      {
        error:
          'รายการนี้มีบางส่วนย้ายไปชำระข้ามเดือนแล้ว — ต้องลบรายการชำระนั้นที่แถบ "ชำระข้ามเดือน" ก่อน',
      },
      { status: 409 }
    );
  }

  const updated = await prisma.statementTransfer.update({
    where: { id: transfer.id },
    data: { excludedReason },
    select: { id: true, amount: true, memberNumber: true, excludedReason: true },
  });

  // Totals move the moment the money changes meaning, so the member's status
  // on screen matches what was just decided about their payment.
  await recomputeRoundPayments(params.id);

  return NextResponse.json(updated);
}
