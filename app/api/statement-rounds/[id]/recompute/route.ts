import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ROUND_CLOSED_ERROR } from "@/lib/carriedDebt";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { absorbCoveredStandIns } from "@/lib/bridgeDedupeStore";

export const dynamic = "force-dynamic";

// "🔄 คำนวณยอดใหม่": rebuilds every member's figures from the transfers the
// round holds. Nothing new is written by it — it is for a round whose rows
// have fallen behind its transfers, which is what a recompute that ran out
// of time on the server left behind (29755: the unit's ฿13,500 placed in
// September, the member still showing "—").
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({
    where: { id: params.id },
    select: { closedAt: true },
  });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
  // A closed round's figures are what its carried debts were taken from.
  if (round.closedAt) {
    return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });
  }
  // Also mends a line counted twice: put on a member from the daily page,
  // then uploaded into the round with the statement (see
  // lib/bridgeDedupe.ts).
  const merged = await absorbCoveredStandIns(params.id);
  await recomputeRoundPayments(params.id);
  return NextResponse.json({ ok: true, merged });
}
