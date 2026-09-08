import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAccountNumber } from "@/lib/statementReconcile";
import { memberNumberKey } from "@/lib/memberNumber";
import {
  applyDirectoryAccounts,
  recomputeRoundPayments,
  rematchRoundTransfers,
} from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// Binds one of "โอนเข้ามาแต่ไม่พบเจ้าของ" to a member, from inside the round
// the staff member is looking at.
//
// Saving to the directory and re-reconciling are one action on purpose: the
// point of the binding is the money moving to the right person on screen, and
// leaving those as two steps would let a saved binding sit there looking like
// it had done nothing.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const body = await request.json();
  const accountNumber = normalizeAccountNumber(body.accountNumber);
  const memberNumber = memberNumberKey(String(body.memberNumber ?? "")) ?? "";

  if (!accountNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขบัญชี" }, { status: 400 });
  }
  if (!memberNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขสมาชิก" }, { status: 400 });
  }

  const member = await prisma.statementMember.findUnique({
    where: { roundId_memberNumber: { roundId: round.id, memberNumber } },
    select: { name: true },
  });
  if (!member) {
    return NextResponse.json(
      {
        error: `ไม่พบเลขสมาชิก ${memberNumber} ในรอบนี้ — เงินก้อนนี้อาจเป็นของคนที่ไม่ได้อยู่ในรายชื่อหักไม่ได้รอบนี้`,
      },
      { status: 400 }
    );
  }

  await prisma.memberBankAccount.upsert({
    where: { accountNumber },
    create: { accountNumber, memberNumber, memberName: member.name },
    update: { memberNumber, memberName: member.name },
  });

  await applyDirectoryAccounts(round.id);
  await rematchRoundTransfers(round.id);
  await recomputeRoundPayments(round.id);

  const matched = await prisma.statementTransfer.aggregate({
    where: { roundId: round.id, accountNumber },
    _count: { _all: true },
    _sum: { amount: true },
  });

  return NextResponse.json({
    accountNumber,
    memberNumber,
    memberName: member.name,
    transfers: matched._count._all,
    amount: Math.round((matched._sum.amount ?? 0) * 100) / 100,
  });
}
