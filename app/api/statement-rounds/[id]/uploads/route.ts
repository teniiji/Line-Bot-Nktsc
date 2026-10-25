import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unitProgress } from "@/lib/roundUnitProgress";

export const dynamic = "force-dynamic";

// What has gone into this round so far: the รายการหัก and ผลการหัก files
// uploaded (lib/uploadHistoryStore.ts keeps them, from the day it was added)
// and, per หน่วยคุม, whether its results are in (lib/roundUnitProgress.ts).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!round) return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });

  const [uploads, members] = await Promise.all([
    prisma.statementFileUpload.findMany({
      where: { roundId: round.id },
      orderBy: { uploadedAt: "desc" },
      select: { kind: true, fileName: true, uploadedAt: true },
    }),
    prisma.statementMember.findMany({
      where: { roundId: round.id },
      select: { hCode: true, unitName: true, deductionResult: true },
    }),
  ]);

  return NextResponse.json({
    uploads: uploads.map((u) => ({ ...u, uploadedAt: u.uploadedAt.toISOString() })),
    units: unitProgress(members),
  });
}
