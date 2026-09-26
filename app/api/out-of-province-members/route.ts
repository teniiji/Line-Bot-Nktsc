import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// The whole list — a few hundred members at most — with the roster's name
// where it has one, and how many each office deducts for.
export async function GET() {
  const members = await prisma.outOfProvinceMember.findMany({
    orderBy: [{ deductingUnit: "asc" }, { memberNumber: "asc" }],
  });
  const roster = members.length
    ? await prisma.memberRoster.findMany({
        where: { memberNumber: { in: members.map((m) => m.memberNumber) } },
        select: { memberNumber: true, memberName: true, unitName: true },
      })
    : [];
  const rosterOf = new Map(roster.map((r) => [r.memberNumber, r]));

  const links = await prisma.unitPayerOffice.findMany();
  const payers = links.length
    ? await prisma.unitPayer.findMany({
        where: { id: { in: links.map((l) => l.payerId) } },
        select: { id: true, name: true },
      })
    : [];
  const payerName = new Map(payers.map((p) => [p.id, p.name]));
  const linkOf = new Map(links.map((l) => [l.deductingUnit, { id: l.payerId, name: payerName.get(l.payerId) ?? "" }]));

  const units = new Map<string, number>();
  for (const m of members) units.set(m.deductingUnit, (units.get(m.deductingUnit) ?? 0) + 1);

  return NextResponse.json({
    data: members.map((m) => ({
      id: m.id,
      memberNumber: m.memberNumber,
      name: rosterOf.get(m.memberNumber)?.memberName ?? m.memberName,
      inRoster: rosterOf.has(m.memberNumber),
      rosterUnit: rosterOf.get(m.memberNumber)?.unitName ?? null,
      deductingUnit: m.deductingUnit,
      originalUnit: m.originalUnit,
      note: m.note,
      updatedAt: m.updatedAt,
    })),
    units: [...units]
      .map(([name, count]) => ({ name, count, linkedTo: linkOf.get(name) ?? null }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th")),
  });
}
