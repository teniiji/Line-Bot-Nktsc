import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { outOfProvinceEntry } from "@/lib/outOfProvinceSheet";
import { syncOfficeMembers } from "@/lib/unitPayerOfficeStore";

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
        select: { id: true, name: true, key: true },
      })
    : [];
  const payerOf = new Map(payers.map((p) => [p.id, p]));
  const linkOf = new Map(
    links.map((l) => [
      l.deductingUnit,
      { id: l.payerId, name: payerOf.get(l.payerId)?.name ?? "", key: payerOf.get(l.payerId)?.key ?? "" },
    ])
  );
  // Whether each member is on the unit their office is linked to — the sync
  // keeps it so, and this is where staff can see that it did.
  const onUnit = links.length
    ? await prisma.unitPayerMember.findMany({
        where: { payerId: { in: links.map((l) => l.payerId) }, memberNumber: { in: members.map((m) => m.memberNumber) } },
        select: { payerId: true, memberNumber: true },
      })
    : [];
  const onUnitSet = new Set(onUnit.map((r) => `${r.payerId}|${r.memberNumber}`));

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
      linkedTo: linkOf.get(m.deductingUnit) ?? null,
      onLinkedUnit: (() => {
        const link = linkOf.get(m.deductingUnit);
        return link ? onUnitSet.has(`${link.id}|${m.memberNumber}`) : false;
      })(),
    })),
    units: [...units]
      .map(([name, count]) => ({ name, count, linkedTo: linkOf.get(name) ?? null }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th")),
  });
}

// One member added by hand, without a file.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const entry = outOfProvinceEntry({ memberNumber: body.memberNumber, deductingUnit: body.deductingUnit });
  if ("error" in entry) return NextResponse.json({ error: entry.error }, { status: 400 });

  const existing = await prisma.outOfProvinceMember.findUnique({ where: { memberNumber: entry.memberNumber } });
  if (existing) {
    return NextResponse.json(
      { error: `${entry.memberNumber} อยู่ในรายชื่อแล้ว (${existing.deductingUnit}) — กด "แก้ไข" ที่แถวนั้นแทน` },
      { status: 409 }
    );
  }
  const roster = await prisma.memberRoster.findUnique({
    where: { memberNumber: entry.memberNumber },
    select: { memberName: true },
  });
  const text = (v: unknown) => String(v ?? "").trim() || null;
  const created = await prisma.outOfProvinceMember.create({
    data: {
      memberNumber: entry.memberNumber,
      memberName: roster?.memberName ?? text(body.memberName),
      deductingUnit: entry.deductingUnit,
      originalUnit: text(body.originalUnit),
      note: text(body.note),
    },
  });
  // Onto the statement unit this office is linked to, if any.
  const { added } = await syncOfficeMembers();
  return NextResponse.json(
    { id: created.id, inRoster: roster !== null, name: roster?.memberName ?? null, addedToUnits: added },
    { status: 201 }
  );
}
