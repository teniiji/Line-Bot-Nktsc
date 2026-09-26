import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Renaming a unit, or forgetting it altogether. Forgetting touches nothing
// already recorded: the transactions, the round rows and the divisions made
// from its transfers all stay — only the recognising of its next one stops.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "ต้องมีชื่อหน่วยงาน" }, { status: 400 });
  const payer = await prisma.unitPayer.findUnique({ where: { id: params.id } });
  if (!payer) return NextResponse.json({ error: "ไม่พบหน่วยงานนี้" }, { status: 404 });
  await prisma.unitPayer.update({ where: { id: payer.id }, data: { name } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const payer = await prisma.unitPayer.findUnique({ where: { id: params.id } });
  if (!payer) return NextResponse.json({ error: "ไม่พบหน่วยงานนี้" }, { status: 404 });
  await prisma.$transaction([
    prisma.unitPayerMember.deleteMany({ where: { payerId: payer.id } }),
    prisma.statementLineSplit.updateMany({ where: { payerId: payer.id }, data: { payerId: null } }),
    prisma.unitPayer.delete({ where: { id: payer.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
