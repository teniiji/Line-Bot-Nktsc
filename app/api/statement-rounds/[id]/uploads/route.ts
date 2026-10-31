import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unitProgress } from "@/lib/roundUnitProgress";
import { readChanges } from "@/lib/uploadUndo";

export const dynamic = "force-dynamic";

// What has gone into this round so far: the รายการหัก and ผลการหัก files
// uploaded (lib/uploadHistoryStore.ts keeps them, from the day it was added)
// and, per หน่วยคุม, whether its results are in (lib/roundUnitProgress.ts).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id }, select: { id: true, closedAt: true } });
  if (!round) return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });

  const [uploads, members] = await Promise.all([
    prisma.statementFileUpload.findMany({
      where: { roundId: round.id },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, kind: true, fileName: true, fileHash: true, uploadedAt: true, changes: true },
    }),
    prisma.statementMember.findMany({
      where: { roundId: round.id },
      select: { hCode: true, unitName: true, deductionResult: true },
    }),
  ]);

  return NextResponse.json({
    uploads: uploads.map((u) => {
      const changes = u.kind === "results" ? readChanges(u.changes) : null;
      return {
        id: u.id,
        kind: u.kind,
        fileName: u.fileName,
        uploadedAt: u.uploadedAt.toISOString(),
        // How many members it changed, when that was kept — and so whether
        // it can be undone rather than only taken off the list.
        changed: changes ? changes.length : null,
        // The same bytes uploaded more than once into this round.
        repeats: uploads.filter((o) => o.fileHash === u.fileHash).length,
      };
    }),
    closed: round.closedAt !== null,
    units: unitProgress(members),
  });
}
