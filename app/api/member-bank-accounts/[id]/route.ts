import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rematchRoundsForAccount } from "@/lib/statementRecompute";

// Removes a binding. Only the mapping goes — no transfer, member or round is
// deleted; the rounds that used it are re-reconciled so the money returns to
// "โอนเข้ามาแต่ไม่พบเจ้าของ", where it is visible and can be bound to somebody
// else, rather than staying quietly credited to the wrong member.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const entry = await prisma.memberBankAccount.findUnique({
    where: { id: params.id },
    select: { accountNumber: true },
  });
  if (!entry) {
    return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 });
  }

  await prisma.memberBankAccount.delete({ where: { id: params.id } });
  const rounds = await rematchRoundsForAccount(entry.accountNumber);

  return NextResponse.json({ ok: true, rounds });
}
