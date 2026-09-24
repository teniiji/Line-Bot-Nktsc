import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ROUND_CLOSED_ERROR } from "@/lib/carriedDebt";
import { memberNumberKey } from "@/lib/memberNumber";
import { dayStart, cooperativeToday } from "@/lib/cooperativeClock";
import { recomputeRoundPayments } from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// A member walking into the office and handing over cash is money this round
// has no other way to hear about: it never touches a bank account, so no
// Statement upload will ever carry it, and the daily view's whole matching
// pipeline (senderAccount, slip pairing) has nothing to work from either.
//
// Recorded the same shape as a real transfer rather than a separate field on
// StatementMember, so it gets everything a transfer already has for free —
// shows up in "รายการโอนของ {name}" beside the real ones, counts toward
// amountPaid through the one recomputeRoundPayments already trusted, and can
// be corrected the same way a wrong transfer is (the excludedReason
// dropdown) if somebody mistypes the amount. account/branch are "cash"/
// "เงินสด" rather than 413/447 so it never reads as belonging to either
// account's own Statement — see the บัญชี filter on ส่งออก CSV.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
  if (round.closedAt) {
    return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });
  }

  const body = await request.json();
  const memberNumber = memberNumberKey(String(body.memberNumber ?? ""));
  if (!memberNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขสมาชิก" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "จำนวนเงินต้องมากกว่า 0" }, { status: 400 });
  }

  const day = String(body.transferredAt ?? "").trim() || cooperativeToday();
  const transferredAt = dayStart(day);
  if (!transferredAt) {
    return NextResponse.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 });
  }

  const onRound = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: { memberNumber: true, name: true },
  });
  const member = onRound.find((m) => memberNumberKey(m.memberNumber) === memberNumber) ?? null;
  if (!member) {
    return NextResponse.json(
      { error: "เลขสมาชิกนี้ไม่มีอยู่ในรอบนี้" },
      { status: 400 }
    );
  }

  const created = await prisma.statementTransfer.create({
    data: {
      roundId: round.id,
      memberNumber: member.memberNumber,
      accountNumber: "เงินสด",
      amount,
      transferredAt,
      account: "cash",
      branch: "เงินสด",
      description: "ชำระเงินสดที่สำนักงาน",
      // Never read off a bank line, so given its own identity rather than
      // one derived from a file — the same approach a split's new row uses.
      fingerprint: `cash:${round.id}:${member.memberNumber}:${randomUUID()}`,
      manualMemberNumber: true,
    },
    select: { id: true, amount: true, transferredAt: true },
  });

  await recomputeRoundPayments(round.id);

  return NextResponse.json({
    id: created.id,
    memberNumber: member.memberNumber,
    memberName: member.name,
    amount: created.amount,
  });
}
