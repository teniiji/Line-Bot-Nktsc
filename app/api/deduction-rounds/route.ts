import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  parseDeductionPeriod,
  describeDeductionPeriod,
} from "@/lib/deductionPeriod";

export const dynamic = "force-dynamic";

// Rounds of รายการหัก, newest first, each with a count of how far along it is
// so the list answers "which month still needs work" without opening any of
// them.
export async function GET() {
  const rounds = await prisma.deductionRound.findMany({
    orderBy: { period: "desc" },
  });

  // DeductionUnitFile.roundId isn't a Prisma relation (see the model comment
  // in schema.prisma) — one grouped count instead of a query per round.
  const grouped = await prisma.deductionUnitFile.groupBy({
    by: ["roundId", "sendStatus"],
    _count: { _all: true },
  });
  const withFile = await prisma.deductionUnitFile.groupBy({
    by: ["roundId"],
    where: { filePath: { not: null } },
    _count: { _all: true },
  });
  const fileCountByRound = new Map(withFile.map((g) => [g.roundId, g._count._all]));

  const statusByRound = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const entry = statusByRound.get(row.roundId) ?? {};
    entry[row.sendStatus] = row._count._all;
    statusByRound.set(row.roundId, entry);
  }

  const data = rounds.map((r) => {
    const status = statusByRound.get(r.id) ?? {};
    const total = Object.values(status).reduce((sum, n) => sum + n, 0);
    return {
      id: r.id,
      period: r.period,
      label: r.label,
      note: r.note,
      closedAt: r.closedAt,
      createdAt: r.createdAt,
      totalUnits: total,
      readyUnits: fileCountByRound.get(r.id) ?? 0,
      sentUnits: status.sent ?? 0,
      failedUnits: status.failed ?? 0,
    };
  });

  return NextResponse.json({ data });
}

// Creating a round also writes one row per unit in OrganizationUnit up front,
// rather than creating them lazily as files arrive. That way the round opens
// as a complete checklist of every unit that is owed a file — a unit nobody
// has touched is visibly outstanding instead of simply absent, which is the
// failure mode this whole panel exists to prevent.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const period = typeof body.period === "string" ? body.period.trim() : "";
  // The label is derived from the period unless one is supplied, so the two
  // can't drift apart (a round labelled "สิงหาคม" sitting under 0969 would
  // send the wrong month's expectations to 60+ units).
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : describeDeductionPeriod(period);

  if (!parseDeductionPeriod(period)) {
    return NextResponse.json(
      { error: 'รหัสรอบต้องเป็นตัวเลข 4 หลักแบบ MMYY เช่น "0969" (กันยายน 2569)' },
      { status: 400 }
    );
  }

  const existing = await prisma.deductionRound.findUnique({ where: { period } });
  if (existing) {
    return NextResponse.json({ error: `มีรอบ ${period} อยู่แล้ว` }, { status: 409 });
  }

  const units = await prisma.organizationUnit.findMany({ select: { name: true } });
  if (units.length === 0) {
    return NextResponse.json(
      {
        error:
          "ยังไม่มีข้อมูลหน่วยงานในระบบ — นำเข้าด้วย scripts/import-org-data.ts ก่อนสร้างรอบ",
      },
      { status: 400 }
    );
  }

  const round = await prisma.deductionRound.create({
    data: {
      period,
      label,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    },
  });
  await prisma.deductionUnitFile.createMany({
    data: units.map((u) => ({ roundId: round.id, unitName: u.name })),
  });

  return NextResponse.json({ ...round, totalUnits: units.length }, { status: 201 });
}
