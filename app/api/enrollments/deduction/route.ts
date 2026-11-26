import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DEDUCTION_PRODUCTS,
  enrolledButUndeducted,
  feeKey,
  outstandingDeductionChanges,
  premiumsToCollect,
} from "@/lib/enrollmentDeductions";

export const dynamic = "force-dynamic";

// GET — what the รายการหัก has to change, premiums to collect, and members who
// applied but were หักไม่ได้ in the month their change was put in.
export async function GET() {
  const [open, placed, feeRows] = await Promise.all([
    prisma.coverageEnrollment.findMany({
      where: {
        status: { not: "rejected" },
        OR: [
          { product: { in: [...DEDUCTION_PRODUCTS] }, deductionPeriod: null },
          { product: "life", action: "enroll", premiumPaidAt: null },
        ],
      },
      orderBy: { applicationDate: "asc" },
    }),
    prisma.coverageEnrollment.findMany({
      where: { status: { not: "rejected" }, action: "enroll", deductionPeriod: { not: null } },
      orderBy: { applicationDate: "desc" },
      take: 2000,
    }),
    prisma.appSetting.findMany({ where: { key: { in: DEDUCTION_PRODUCTS.map(feeKey) } } }),
  ]);

  // The rounds for the months changes were put into, and who was หักไม่ได้
  // and still unpaid in each.
  const periods = [...new Set(placed.map((r) => r.deductionPeriod!))];
  const rounds = periods.length
    ? await prisma.statementRound.findMany({ where: { period: { in: periods } }, select: { id: true, period: true, label: true } })
    : [];
  const uncollectedByPeriod = new Map<string, Set<string>>();
  for (const round of rounds) {
    const members = await prisma.statementMember.findMany({
      where: { roundId: round.id, deductionResult: "uncollected", status: "unpaid" },
      select: { memberNumber: true },
    });
    uncollectedByPeriod.set(round.period, new Set(members.map((m) => m.memberNumber)));
  }

  const { add, remove } = outstandingDeductionChanges(open);
  return NextResponse.json({
    add,
    remove,
    premiums: premiumsToCollect(open),
    undeducted: enrolledButUndeducted(placed, uncollectedByPeriod).map((r) => ({
      ...r,
      roundLabel: rounds.find((x) => x.period === r.deductionPeriod)?.label ?? r.deductionPeriod,
    })),
    roundsChecked: rounds.map((r) => r.label),
    fees: Object.fromEntries(DEDUCTION_PRODUCTS.map((p) => [p, Number(feeRows.find((f) => f.key === feeKey(p))?.value) || null])),
  });
}

// POST { ids, period } — put these changes into that month's รายการหัก;
// period null takes them back out.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const period = body.period == null ? null : String(body.period);
  if (!ids.length) return NextResponse.json({ error: "ไม่ได้เลือกรายการ" }, { status: 400 });
  if (period !== null && !/^\d{4}$/.test(period)) return NextResponse.json({ error: "เดือนไม่ถูกต้อง" }, { status: 400 });
  const { count } = await prisma.coverageEnrollment.updateMany({
    where: { id: { in: ids } },
    data: { deductionPeriod: period, deductionMarkedAt: period ? new Date() : null },
  });
  return NextResponse.json({ updated: count });
}
