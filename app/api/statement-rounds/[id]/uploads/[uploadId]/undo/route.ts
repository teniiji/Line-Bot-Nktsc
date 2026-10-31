import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ROUND_CLOSED_ERROR } from "@/lib/carriedDebt";
import { refreshRoundProgress } from "@/lib/roundMembers";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { type CurrentMember, planUndo, readChanges } from "@/lib/uploadUndo";

export const dynamic = "force-dynamic";

// Takes a ผลการหัก file back out of the round: members it changed go back to
// what they were, members it added leave — wherever its result still stands
// (lib/uploadUndo.ts). Then the file leaves the list.
export async function POST(_request: Request, { params }: { params: { id: string; uploadId: string } }) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  if (round.closedAt) return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });

  const upload = await prisma.statementFileUpload.findFirst({ where: { id: params.uploadId, roundId: round.id } });
  if (!upload) return NextResponse.json({ error: "ไม่พบไฟล์นี้ในรอบ" }, { status: 404 });
  const changes = upload.kind === "results" ? readChanges(upload.changes) : null;
  if (!changes) {
    return NextResponse.json(
      { error: "ไฟล์นี้อัปก่อนระบบเริ่มจำว่าแก้ใครไปบ้าง จึงยกเลิกผลอัตโนมัติไม่ได้ — ลบออกจากรายการได้อย่างเดียว" },
      { status: 400 }
    );
  }

  const numbers = changes.map((c) => c.memberNumber);
  const [members, transfers] = await Promise.all([
    prisma.statementMember.findMany({
      where: { roundId: round.id, memberNumber: { in: numbers } },
      select: { memberNumber: true, deductionResult: true, amountDue: true, amountPaid: true },
    }),
    prisma.statementTransfer.groupBy({
      by: ["memberNumber"],
      where: { roundId: round.id, memberNumber: { in: numbers } },
      _count: { _all: true },
    }),
  ]);
  const transfersOf = new Map(transfers.map((t) => [t.memberNumber, t._count._all]));
  const current = new Map<string, CurrentMember>(
    members.map((m) => [m.memberNumber, { ...m, transfers: transfersOf.get(m.memberNumber) ?? 0 }])
  );
  const plan = planUndo(changes, current);

  for (const { memberNumber, before } of plan.restore) {
    await prisma.statementMember.update({
      where: { roundId_memberNumber: { roundId: round.id, memberNumber } },
      data: {
        deductionResult: before.deductionResult,
        amountDue: before.amountDue,
        expectedAmount: before.expectedAmount,
      },
    });
  }
  if (plan.remove.length) {
    await prisma.statementMember.deleteMany({ where: { roundId: round.id, memberNumber: { in: plan.remove } } });
  }
  await prisma.statementFileUpload.delete({ where: { id: upload.id } });
  await recomputeRoundPayments(round.id);
  await refreshRoundProgress(round.id);

  return NextResponse.json({
    ok: true,
    restored: plan.restore.length,
    removed: plan.remove.length,
    skipped: plan.skipped,
  });
}
