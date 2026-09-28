import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import { bridgeLineToRound } from "@/lib/lineBridgeStore";

export const dynamic = "force-dynamic";

// Counts an already-recorded line in its month's round, for a recording the
// round turned away at the time (the member was settled, or had no result
// yet) but now agrees is owed — see lib/lineBridgeStore.ts.
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const line = await prisma.statementLine.findUnique({ where: { id: params.id } });
  const recording = line
    ? await prisma.expense.findUnique({ where: { statementLineId: line.id } })
    : null;
  if (!line || !recording || recording.category !== DEDUCTION_CATEGORY || !recording.memberNumber) {
    return NextResponse.json(
      { error: "ไม่พบรายการชำระเก็บไม่ได้รายเดือนที่บันทึกจากบรรทัดนี้" },
      { status: 404 }
    );
  }
  // The recording's own amount: anything set aside from it (สสค …) is not
  // the deduction and stays out of the round.
  const outcome = await bridgeLineToRound(line, recording.memberNumber, recording.amount);
  if (!outcome.bridged) return NextResponse.json({ error: outcome.reason }, { status: 409 });
  return NextResponse.json({ ok: true, round: outcome.round, amount: recording.amount });
}
