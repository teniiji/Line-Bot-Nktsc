import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";

export const dynamic = "force-dynamic";

// Every carried debt (ชำระข้ามเดือน), with the payments made toward it.
//
// ?open=1 narrows to debts still owing — what the round page reads to warn
// that a member paying this month also owes an earlier one. ?memberNumber=
// narrows to one member, for the picker that moves a transfer onto a debt.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const open = searchParams.get("open") === "1";
  const memberNumber = memberNumberKey(searchParams.get("memberNumber") ?? "");

  const debts = await prisma.carriedDebt.findMany({
    where: open ? { status: "unpaid" } : {},
    orderBy: [{ createdAt: "desc" }, { memberNumber: "asc" }],
  });
  const wanted = memberNumber
    ? debts.filter((d) => memberNumberKey(d.memberNumber) === memberNumber)
    : debts;

  const payments = wanted.length
    ? await prisma.carriedDebtPayment.findMany({
        where: { debtId: { in: wanted.map((d) => d.id) } },
        orderBy: { paidAt: "asc" },
      })
    : [];
  const roundIds = [...new Set(payments.map((p) => p.roundId).filter(Boolean))] as string[];
  const rounds = roundIds.length
    ? await prisma.statementRound.findMany({
        where: { id: { in: roundIds } },
        select: { id: true, label: true },
      })
    : [];
  const labelOf = new Map(rounds.map((r) => [r.id, r.label]));

  const byDebt = new Map<string, typeof payments>();
  for (const payment of payments) {
    byDebt.set(payment.debtId, [...(byDebt.get(payment.debtId) ?? []), payment]);
  }

  return NextResponse.json({
    data: wanted.map((debt) => ({
      id: debt.id,
      sourceRoundId: debt.sourceRoundId,
      sourceLabel: debt.sourceLabel,
      memberNumber: debt.memberNumber,
      name: debt.name,
      hCode: debt.hCode,
      unitName: debt.unitName,
      unitCode: debt.unitCode,
      accountNumber: debt.accountNumber,
      amount: debt.amount,
      amountPaid: debt.amountPaid,
      paidAt: debt.paidAt,
      status: debt.status,
      payments: (byDebt.get(debt.id) ?? []).map((p) => ({
        id: p.id,
        amount: p.amount,
        paidAt: p.paidAt,
        method: p.method,
        roundLabel: p.roundId ? labelOf.get(p.roundId) ?? null : null,
        accountNumber: p.accountNumber,
        note: p.note,
      })),
    })),
  });
}
