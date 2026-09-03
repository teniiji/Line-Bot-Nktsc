import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { describeDeductionPeriod } from "@/lib/deductionPeriod";

export const dynamic = "force-dynamic";

export async function GET() {
  const rounds = await prisma.statementRound.findMany({
    orderBy: { period: "desc" },
  });

  // Counts per status for the round switcher, in one grouped query rather
  // than a findMany per round.
  const grouped = await prisma.statementMember.groupBy({
    by: ["roundId", "status"],
    _count: { _all: true },
  });

  const data = rounds.map((round) => {
    const rows = grouped.filter((g) => g.roundId === round.id);
    const countFor = (status: string) =>
      rows.find((r) => r.status === status)?._count._all ?? 0;
    return {
      ...round,
      totalMembers: rows.reduce((sum, r) => sum + r._count._all, 0),
      paidMembers: countFor("paid"),
      overpaidMembers: countFor("overpaid"),
      unpaidMembers: countFor("unpaid"),
    };
  });

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const period = String(body.period ?? "").trim();

  if (!/^\d{4}$/.test(period)) {
    return NextResponse.json(
      { error: "รหัสรอบต้องเป็นตัวเลข 4 หลักแบบ MMYY เช่น 0669" },
      { status: 400 }
    );
  }

  // Same label-from-period rule as รายการหัก, so a Statement round and the
  // deduction round it follows read identically in both tabs.
  const label = String(body.label ?? "").trim() || describeDeductionPeriod(period);
  if (!label) {
    return NextResponse.json({ error: "รหัสรอบไม่ถูกต้อง" }, { status: 400 });
  }

  const existing = await prisma.statementRound.findUnique({ where: { period } });
  if (existing) {
    return NextResponse.json({ error: `มีรอบ ${period} อยู่แล้ว` }, { status: 409 });
  }

  const round = await prisma.statementRound.create({ data: { period, label } });
  return NextResponse.json({ ...round, totalMembers: 0 });
}
