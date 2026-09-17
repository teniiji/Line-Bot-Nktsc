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
    const paid = countFor("paid");
    const overpaid = countFor("overpaid");
    const unpaid = countFor("unpaid");
    return {
      ...round,
      // The round's chase population: the members payroll could not deduct
      // from. Deliberately not everybody in the round — a round can now start
      // from the รายการหัก, so it also holds members whose unit has not
      // reported and members payroll collected in full, and neither is
      // somebody to chase. Every "x / totalMembers" on the page means this.
      totalMembers: paid + overpaid + unpaid,
      paidMembers: paid,
      overpaidMembers: overpaid,
      unpaidMembers: unpaid,
      // The two states a round seeded from the รายการหัก has and an old one
      // never did: no result from the unit yet, and deducted in full.
      awaitingResult: countFor("awaiting"),
      collectedMembers: countFor("collected"),
      // Everyone the round knows about, which is what says whether it has
      // been started at all.
      populationMembers: rows.reduce((sum, r) => sum + r._count._all, 0),
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
