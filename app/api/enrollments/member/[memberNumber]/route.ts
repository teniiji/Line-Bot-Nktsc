import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";

export const dynamic = "force-dynamic";

// Who the number is, and what they already hold — the current coverage file
// and applications since — so staff see a duplicate before recording one.
export async function GET(_request: NextRequest, { params }: { params: { memberNumber: string } }) {
  const memberNumber = memberNumberKey(decodeURIComponent(params.memberNumber));
  if (!memberNumber) return NextResponse.json({ error: "เลขสมาชิกไม่ถูกต้อง" }, { status: 400 });
  const [roster, coverage, enrollments] = await Promise.all([
    prisma.memberRoster.findUnique({ where: { memberNumber }, select: { memberName: true, unitName: true } }),
    prisma.memberCoverage.findFirst({
      where: { memberNumber, snapshot: { isCurrent: true } },
      select: {
        memberName: true,
        unitName: true,
        age: true,
        sharePeriods: true,
        insuredSum: true,
        hasSok: true,
        hasScs: true,
        hasSst: true,
        hasSsk: true,
        relativeCount: true,
        snapshot: { select: { label: true } },
      },
    }),
    prisma.coverageEnrollment.findMany({
      where: { memberNumber },
      orderBy: { applicationDate: "desc" },
      take: 20,
      select: { id: true, product: true, action: true, status: true, applicationDate: true, relativeName: true },
    }),
  ]);
  return NextResponse.json({
    memberNumber,
    name: roster?.memberName ?? coverage?.memberName ?? null,
    unitName: roster?.unitName ?? coverage?.unitName ?? null,
    inRoster: !!roster,
    coverage,
    enrollments,
  });
}
