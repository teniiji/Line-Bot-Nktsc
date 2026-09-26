import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncOfficeMembers } from "@/lib/unitPayerOfficeStore";

export const dynamic = "force-dynamic";

// Links an out-of-province office to this unit, bringing in every member the
// list has at that office — see lib/unitPayerOffices.ts.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const payer = await prisma.unitPayer.findUnique({ where: { id: params.id } });
  if (!payer) return NextResponse.json({ error: "ไม่พบหน่วยงานนี้" }, { status: 404 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const office = String(body.office ?? "").trim();
  const members = await prisma.outOfProvinceMember.count({ where: { deductingUnit: office } });
  if (!office || members === 0) {
    return NextResponse.json(
      { error: "ไม่พบหน่วยงานหักเงินนี้ในรายชื่อสมาชิกย้ายไปต่างจังหวัด" },
      { status: 400 }
    );
  }
  const existing = await prisma.unitPayerOffice.findUnique({ where: { deductingUnit: office } });
  if (existing) {
    if (existing.payerId === payer.id) return NextResponse.json({ ok: true, added: 0 });
    const other = await prisma.unitPayer.findUnique({ where: { id: existing.payerId }, select: { name: true } });
    return NextResponse.json(
      { error: `"${office}" ผูกกับหน่วยงาน ${other?.name ?? "อื่น"} อยู่แล้ว — ยกเลิกที่นั่นก่อน` },
      { status: 409 }
    );
  }

  await prisma.unitPayerOffice.create({ data: { payerId: payer.id, deductingUnit: office } });
  const { added } = await syncOfficeMembers();
  return NextResponse.json({ ok: true, added });
}

// Unlinks it. Members the link brought in go with it, unless something has
// been recorded for them since.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const office = new URL(request.url).searchParams.get("office")?.trim() ?? "";
  const removedLink = await prisma.unitPayerOffice.deleteMany({
    where: { payerId: params.id, deductingUnit: office },
  });
  if (removedLink.count === 0) {
    return NextResponse.json({ error: "ไม่พบการผูกนี้" }, { status: 404 });
  }
  const { removed } = await syncOfficeMembers();
  return NextResponse.json({ ok: true, removed });
}
