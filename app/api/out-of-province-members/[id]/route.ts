import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncOfficeMembers } from "@/lib/unitPayerOfficeStore";
import { outOfProvinceEntry } from "@/lib/outOfProvinceSheet";

// Corrects one member's office, สังกัดเดิม or หมายเหตุ. A new office moves
// them to that office's linked unit (lib/unitPayerOffices.ts).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const member = await prisma.outOfProvinceMember.findUnique({ where: { id: params.id } });
  if (!member) return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 });
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const entry = outOfProvinceEntry({
    memberNumber: member.memberNumber,
    deductingUnit: body.deductingUnit ?? member.deductingUnit,
  });
  if ("error" in entry) return NextResponse.json({ error: entry.error }, { status: 400 });
  const text = (v: unknown, fallback: string | null) =>
    v === undefined ? fallback : String(v ?? "").trim() || null;
  await prisma.outOfProvinceMember.update({
    where: { id: member.id },
    data: {
      deductingUnit: entry.deductingUnit,
      originalUnit: text(body.originalUnit, member.originalUnit),
      note: text(body.note, member.note),
    },
  });
  const moved = entry.deductingUnit !== member.deductingUnit;
  const sync = moved ? await syncOfficeMembers() : { added: 0, removed: 0 };
  return NextResponse.json({ ok: true, moved, ...sync });
}

export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const removed = await prisma.outOfProvinceMember.deleteMany({ where: { id: params.id } });
  if (removed.count === 0) {
    return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 });
  }
  // Off the unit their office is linked to as well, unless recorded since.
  await syncOfficeMembers();
  return NextResponse.json({ ok: true });
}
