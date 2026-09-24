import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ROUND_CLOSED_ERROR } from "@/lib/carriedDebt";
import { memberNumberKey } from "@/lib/memberNumber";
import { isFullSplit, remainingAfterSplit, splitAmountProblem } from "@/lib/statementSplitTransfer";
import { recomputeRoundPayments } from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// Moves part — or all — of one transfer's credit to a different member on
// the same round. See lib/statementSplitTransfer.ts for why this exists and
// how much of the transfer a split can take.
//
// The member has to already be on this round: recomputeRoundPayments only
// ever credits a StatementMember row, so pointing a transfer at somebody
// this round never heard of would move the money nowhere staff could see —
// the same rule app/api/statement-rounds/[id]/assign/route.ts applies when
// binding an unclaimed account.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; transferId: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
  if (round.closedAt) {
    return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });
  }

  const transfer = await prisma.statementTransfer.findFirst({
    where: { id: params.transferId, roundId: round.id },
  });
  if (!transfer) {
    return NextResponse.json({ error: "ไม่พบรายการโอนนี้ในรอบนี้" }, { status: 404 });
  }
  // Splitting moves the line's amount between rows; the part already paying
  // a carried debt would be moved along with it and counted twice.
  if (transfer.carriedAmount > 0) {
    return NextResponse.json(
      {
        error:
          'รายการนี้มีบางส่วนย้ายไปชำระข้ามเดือนแล้ว — ต้องลบรายการชำระนั้นที่แถบ "ชำระข้ามเดือน" ก่อนถึงจะแบ่งยอดได้',
      },
      { status: 409 }
    );
  }

  const body = await request.json();
  const memberNumber = memberNumberKey(String(body.memberNumber ?? ""));
  if (!memberNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขสมาชิกที่จะย้ายยอดไปให้" }, { status: 400 });
  }

  // Defaults to the whole transfer — the case where the account holder was
  // never really party to this payment at all, only the one whose name is
  // on the bank account.
  const amount = body.amount === undefined ? transfer.amount : Number(body.amount);
  const problem = splitAmountProblem(transfer.amount, amount);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const onRound = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: { memberNumber: true },
  });
  const target = onRound.find((m) => memberNumberKey(m.memberNumber) === memberNumber) ?? null;
  if (!target) {
    return NextResponse.json(
      { error: "เลขสมาชิกนี้ไม่มีอยู่ในรอบนี้ — ต้องอยู่ในรอบเดียวกันถึงจะรับยอดนี้ได้" },
      { status: 400 }
    );
  }

  if (isFullSplit(transfer.amount, amount)) {
    // Nothing is left for the original account to keep — the whole line
    // moves, in place, rather than leaving a zero-amount row behind it.
    await prisma.statementTransfer.update({
      where: { id: transfer.id },
      data: { memberNumber: target.memberNumber, manualMemberNumber: true, excludedReason: null },
    });
  } else {
    await prisma.$transaction([
      prisma.statementTransfer.update({
        where: { id: transfer.id },
        data: {
          amount: remainingAfterSplit(transfer.amount, amount),
          // Its memberNumber is still the account's own, but the amount is
          // no longer what the bank line said — a re-upload of the same
          // statement (exports overlap date ranges routinely) refreshes a
          // fingerprint it already has straight from the file otherwise,
          // which would silently put the split-off share back.
          manualMemberNumber: true,
        },
      }),
      prisma.statementTransfer.create({
        data: {
          roundId: round.id,
          memberNumber: target.memberNumber,
          accountNumber: transfer.accountNumber,
          amount,
          transferredAt: transfer.transferredAt,
          account: transfer.account,
          branch: transfer.branch,
          description: transfer.description,
          // Unique within the round like every other transfer's fingerprint,
          // but this row was never a line of its own in any statement, so it
          // is given an identity rather than one read off a file.
          fingerprint: `${transfer.fingerprint}::split:${randomUUID()}`,
          sourceFile: transfer.sourceFile,
          manualMemberNumber: true,
        },
      }),
    ]);
  }

  await recomputeRoundPayments(round.id);

  return NextResponse.json({ ok: true });
}
