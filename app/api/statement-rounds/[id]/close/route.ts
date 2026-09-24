import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { outstandingAtClose } from "@/lib/carriedDebt";

export const dynamic = "force-dynamic";

// Closes a round at month end: the round is frozen, and every member it was
// still chasing becomes a carried debt (ชำระข้ามเดือน) for exactly what they
// were short — see lib/carriedDebt.ts for who that is.
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
  if (round.closedAt) {
    return NextResponse.json({ error: "รอบนี้ปิดไปแล้ว" }, { status: 409 });
  }

  const members = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: {
      memberNumber: true,
      name: true,
      hCode: true,
      unitName: true,
      unitCode: true,
      accountNumber: true,
      deductionResult: true,
      status: true,
      amountDue: true,
      amountPaid: true,
    },
  });

  const debts = members
    .map((member) => ({ member, amount: outstandingAtClose(member) }))
    .filter(({ amount }) => amount > 0)
    .map(({ member, amount }) => ({
      sourceRoundId: round.id,
      sourceLabel: round.label,
      memberNumber: member.memberNumber,
      name: member.name,
      hCode: member.hCode,
      unitName: member.unitName,
      unitCode: member.unitCode,
      accountNumber: member.accountNumber,
      amount,
    }));

  await prisma.$transaction([
    prisma.statementRound.update({
      where: { id: round.id },
      data: { closedAt: new Date() },
    }),
    prisma.carriedDebt.createMany({ data: debts, skipDuplicates: true }),
  ]);

  return NextResponse.json({
    carried: debts.length,
    carriedAmount: Math.round(debts.reduce((sum, d) => sum + d.amount, 0) * 100) / 100,
    // Members whose unit never reported by the time the round closed. They
    // carry nothing — nobody has said they owe anything — and staff should
    // know that before assuming the round's list is finished.
    awaiting: members.filter((m) => m.deductionResult === "awaiting").length,
  });
}

// Reopens a round closed by mistake. Only while none of its carried debts has
// been paid toward: undoing a close that payments already rely on would leave
// that money pointing at a debt that no longer exists.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
  if (!round.closedAt) {
    return NextResponse.json({ error: "รอบนี้ยังไม่ได้ปิด" }, { status: 409 });
  }

  const debts = await prisma.carriedDebt.findMany({
    where: { sourceRoundId: round.id },
    select: { id: true },
  });
  const paid = await prisma.carriedDebtPayment.count({
    where: { debtId: { in: debts.map((d) => d.id) } },
  });
  if (paid > 0) {
    return NextResponse.json(
      {
        error:
          `เปิดรอบอีกครั้งไม่ได้ — มีการชำระหนี้ข้ามเดือนของรอบนี้ไปแล้ว ${paid} รายการ ` +
          `ต้องลบรายการชำระเหล่านั้นที่แถบ "ชำระข้ามเดือน" ก่อน`,
      },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.carriedDebt.deleteMany({ where: { sourceRoundId: round.id } }),
    prisma.statementRound.update({ where: { id: round.id }, data: { closedAt: null } }),
  ]);

  return NextResponse.json({ reopened: true, removedDebts: debts.length });
}
