import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dayStart, cooperativeToday } from "@/lib/cooperativeClock";
import { recomputeCarriedDebt } from "@/lib/carriedDebtStore";

export const dynamic = "force-dynamic";

// Records cash paid toward a carried debt at the office.
//
// Cash only, on purpose. A transfer is the bank's record and already lives
// in a round's statement; entering it here as well would count the same
// money twice the moment that statement is uploaded (the ชูศักดิ์ case, see
// coveredByRealTransfer in lib/roundReach.ts). Transfers reach a carried
// debt from the round they arrived in — see
// app/api/statement-rounds/[id]/transfers/[transferId]/carry.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const debt = await prisma.carriedDebt.findUnique({ where: { id: params.id } });
  if (!debt) {
    return NextResponse.json({ error: "ไม่พบหนี้รายการนี้" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "จำนวนเงินต้องมากกว่า 0" }, { status: 400 });
  }
  const day = String(body.paidAt ?? "").trim() || cooperativeToday();
  const paidAt = dayStart(day);
  if (!paidAt) {
    return NextResponse.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 });
  }
  const note = String(body.note ?? "").trim() || null;

  const payment = await prisma.carriedDebtPayment.create({
    data: { debtId: debt.id, amount, paidAt, method: "cash", note },
    select: { id: true },
  });
  await recomputeCarriedDebt(debt.id);

  return NextResponse.json({ id: payment.id });
}
