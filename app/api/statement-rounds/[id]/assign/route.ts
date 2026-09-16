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

  // Matched on the comparable form rather than the string. The sheet writes
  // member numbers as it likes, and "029819" is the same member as "29819" —
  // looking the number up exactly would refuse somebody who is on the round,
  // with a message saying they are not. See lib/memberNumber.ts.
  const onRound = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: { memberNumber: true, name: true },
  });
  const member = onRound.find((m) => memberNumberKey(m.memberNumber) === memberNumber) ?? null;

  // Not on this round's list used to be a refusal. It should not be.
  //
  // "This account belongs to member X" is a fact about an account — true for
  // every future round and for the daily page — and one month's หักไม่ได้
  // sheet not listing the member says nothing about it: somebody who owed
  // nothing in August still transfers in August. Refusing threw the fact away
  // and left a list of hundreds of unclaimed transfers on which the only
  // offered action failed.
  //
  // So it is written, and the answer says plainly that this round will not
  // count the money — the member owes nothing here, so there is nothing for
  // it to settle.
  const roster = await prisma.memberRoster.findUnique({
    where: { memberNumber },
    select: { memberName: true },
  });
  const memberName = member?.name ?? roster?.memberName ?? null;

  await prisma.memberBankAccount.upsert({
    where: { accountNumber },
    create: { accountNumber, memberNumber, memberName },
    update: { memberNumber, memberName },
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
    memberName,
    transfers: matched._count._all,
    amount: Math.round((matched._sum.amount ?? 0) * 100) / 100,
    // False when the binding was saved but this round has nothing for the
    // member to settle, and false again when the number is in no list at all
    // — the second being the shape of a typo.
    onRound: member !== null,
    inRoster: roster !== null,
  });
}
