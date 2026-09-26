import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ROUND_CLOSED_ERROR, countedAmount } from "@/lib/carriedDebt";
import { formatAmount } from "@/lib/format";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import {
  SET_ASIDE_MARKER,
  isSetAsidePiece,
  parentFingerprintOf,
  setAsideProblem,
} from "@/lib/transferSetAside";

export const dynamic = "force-dynamic";

// "ตัดยอดออก": cuts part of one transfer out of the round and files it as the
// member's payment in its own category — see lib/transferSetAside.ts.
//
// POST on the transfer: { amount, category }. The cut-out part becomes a row
// of its own beside it, left out of the round under that category, and a
// transaction of the member's on the ธุรกรรม tab.
// DELETE on the cut-out row: puts it back into the row it came from and
// removes the transaction.

async function openRound(id: string) {
  const round = await prisma.statementRound.findUnique({ where: { id } });
  if (!round) return { error: NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 }) };
  if (round.closedAt) return { error: NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 }) };
  return { round };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; transferId: string } }
) {
  const { round, error } = await openRound(params.id);
  if (!round) return error;

  const transfer = await prisma.statementTransfer.findFirst({
    where: { id: params.transferId, roundId: round.id },
  });
  if (!transfer) {
    return NextResponse.json({ error: "ไม่พบรายการโอนนี้ในรอบนี้" }, { status: 404 });
  }
  if (isSetAsidePiece(transfer.fingerprint)) {
    return NextResponse.json({ error: "รายการนี้เป็นยอดที่ตัดออกมาแล้ว" }, { status: 409 });
  }
  if (transfer.excludedReason) {
    return NextResponse.json(
      { error: `รายการนี้ไม่นับในรอบอยู่แล้ว (${transfer.excludedReason})` },
      { status: 409 }
    );
  }
  if (!transfer.memberNumber) {
    return NextResponse.json(
      { error: "ยังไม่รู้ว่ารายการนี้เป็นของใคร — ระบุเจ้าของก่อน แล้วค่อยตัดยอดออก" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const category = String(body.category ?? "");
  const problem = setAsideProblem(countedAmount(transfer), amount, category);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const roster = await prisma.memberRoster.findFirst({
    where: { memberNumber: transfer.memberNumber },
    select: { memberName: true },
  });

  const pieceId = randomUUID();
  await prisma.$transaction([
    prisma.statementTransfer.update({
      where: { id: transfer.id },
      data: {
        amount: Math.round((transfer.amount - amount) * 100) / 100,
        // No longer the amount the bank line says: a re-upload of the same
        // export must not put the cut-out part back (see the statement route).
        manualMemberNumber: true,
      },
    }),
    prisma.statementTransfer.create({
      data: {
        id: pieceId,
        roundId: round.id,
        memberNumber: transfer.memberNumber,
        accountNumber: transfer.accountNumber,
        amount,
        transferredAt: transfer.transferredAt,
        account: transfer.account,
        branch: transfer.branch,
        description: transfer.description,
        fingerprint: `${transfer.fingerprint}${SET_ASIDE_MARKER}${randomUUID()}`,
        sourceFile: transfer.sourceFile,
        excludedReason: category,
        manualMemberNumber: true,
      },
    }),
    prisma.expense.create({
      data: {
        amount,
        category,
        description: `${category} ที่ตัดออกจากยอดโอน ${formatAmount(transfer.amount)} ในรอบ ${round.label} (บันทึกโดยเจ้าหน้าที่)`,
        date: transfer.transferredAt ?? new Date(),
        memberNumber: transfer.memberNumber,
        memberFullName: roster?.memberName ?? null,
        memberVerified: !!roster,
        setAsideFromId: pieceId,
      },
    }),
  ]);
  await recomputeRoundPayments(round.id);

  return NextResponse.json({ ok: true, amount, category });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; transferId: string } }
) {
  const { round, error } = await openRound(params.id);
  if (!round) return error;

  const piece = await prisma.statementTransfer.findFirst({
    where: { id: params.transferId, roundId: round.id },
  });
  if (!piece || !isSetAsidePiece(piece.fingerprint)) {
    return NextResponse.json({ error: "ไม่พบยอดที่ตัดออกรายการนี้" }, { status: 404 });
  }
  const parent = await prisma.statementTransfer.findFirst({
    where: { roundId: round.id, fingerprint: parentFingerprintOf(piece.fingerprint) },
  });

  // Back into the row it came from; if that row has gone (the account's
  // statements cleared and uploaded again), the part simply counts again
  // where it is rather than vanishing from the round.
  await prisma.$transaction([
    ...(parent
      ? [
          prisma.statementTransfer.update({
            where: { id: parent.id },
            data: { amount: Math.round((parent.amount + piece.amount) * 100) / 100 },
          }),
          prisma.statementTransfer.delete({ where: { id: piece.id } }),
        ]
      : [prisma.statementTransfer.update({ where: { id: piece.id }, data: { excludedReason: null } })]),
    prisma.expense.deleteMany({ where: { setAsideFromId: piece.id } }),
  ]);
  await recomputeRoundPayments(round.id);

  return NextResponse.json({ ok: true, restored: !!parent });
}
