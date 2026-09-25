import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sourceKeyOf } from "@/lib/carriedDebtCandidatesStore";

export const dynamic = "force-dynamic";

// "ไม่ใช่ยอดของหนี้นี้": staff saying a bank line the statement check offered
// for this debt is not paying it — the 29755 case, where the unit's transfer
// the daily page paired with the member's slip was September's deduction, not
// July's debt. Stored by the line's identity across re-uploads, so a
// statement uploaded again does not bring the suggestion back.
//
// body.source: "t:<transferId>" for a round's transfer, "l:<lineId>" for a
// daily line.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const debt = await prisma.carriedDebt.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!debt) {
    return NextResponse.json({ error: "ไม่พบหนี้รายการนี้" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const source = String(body.source ?? "");
  const sourceKey = await sourceKeyOf(source);
  if (!sourceKey) {
    return NextResponse.json({ error: "ไม่พบรายการเงินนี้" }, { status: 404 });
  }
  await prisma.carriedDebtDismissal.upsert({
    where: { debtId_sourceKey: { debtId: debt.id, sourceKey } },
    create: { debtId: debt.id, sourceKey },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

// Shows every hidden suggestion for this debt again.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { count } = await prisma.carriedDebtDismissal.deleteMany({ where: { debtId: params.id } });
  return NextResponse.json({ ok: true, restored: count });
}
