import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Adds a recipient this round's list does not have — a file arrived for an
// agency the unit list was never told about (ศึกษาธิการเลย, sent on with
// ตจว3's files). It becomes an OrganizationUnit too, so the next round lists
// it from the start and its LINE or email can be filled in under
// "ผู้รับรายการหัก". body: { name }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const round = await prisma.deductionRound.findUnique({ where: { id: params.id } });
  if (!round) return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2) {
    return NextResponse.json({ error: "ต้องระบุชื่อหน่วยงาน" }, { status: 400 });
  }

  await prisma.organizationUnit.upsert({
    where: { name },
    create: { name },
    update: {},
  });
  const existing = await prisma.deductionUnitFile.findUnique({
    where: { roundId_unitName: { roundId: round.id, unitName: name } },
  });
  if (!existing) {
    await prisma.deductionUnitFile.create({ data: { roundId: round.id, unitName: name } });
  }
  return NextResponse.json({ ok: true, unitName: name, created: !existing });
}
