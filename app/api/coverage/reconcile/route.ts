import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentSnapshot, enrollmentsSince } from "@/lib/coverageStore";
import { reconcileFile } from "@/lib/coverageReconcile";

export const dynamic = "force-dynamic";

const FILE_FIELDS = {
  memberNumber: true,
  memberName: true,
  unitName: true,
  insuredSum: true,
  hasSok: true,
  hasScs: true,
  hasSst: true,
  hasSsk: true,
  relativeCount: true,
} as const;

// GET ?snapshot= — the yearly file against the register of applications
// (lib/coverageReconcile.ts): what was recorded between the previous file
// and this one, and whether this file shows it.
export async function GET(request: NextRequest) {
  const snapshot = await currentSnapshot(new URL(request.url).searchParams.get("snapshot"));
  if (!snapshot) return NextResponse.json({ snapshot: null, previous: null, items: [] });

  const to = enrollmentsSince(snapshot);
  // The file before this one is the one whose date is latest before it.
  const others = await prisma.coverageSnapshot.findMany({
    where: { id: { not: snapshot.id } },
    select: { id: true, label: true, asOf: true, createdAt: true },
  });
  const previous =
    others
      .filter((s) => enrollmentsSince(s).getTime() < to.getTime())
      .sort((a, b) => enrollmentsSince(b).getTime() - enrollmentsSince(a).getTime())[0] ?? null;
  const from = previous ? enrollmentsSince(previous) : null;

  const [file, before, events] = await Promise.all([
    prisma.memberCoverage.findMany({ where: { snapshotId: snapshot.id }, select: FILE_FIELDS }),
    previous ? prisma.memberCoverage.findMany({ where: { snapshotId: previous.id }, select: FILE_FIELDS }) : null,
    prisma.coverageEnrollment.findMany({
      where: { applicationDate: { lte: to, ...(from ? { gt: from } : {}) }, status: { not: "rejected" } },
      select: {
        memberNumber: true,
        memberName: true,
        unitName: true,
        product: true,
        action: true,
        status: true,
        applicationDate: true,
      },
    }),
  ]);

  const items = reconcileFile(file, before, events, { from, to });
  return NextResponse.json({
    snapshot: { id: snapshot.id, label: snapshot.label, date: to },
    previous: previous ? { id: previous.id, label: previous.label, date: from } : null,
    eventsChecked: events.length,
    items,
  });
}
