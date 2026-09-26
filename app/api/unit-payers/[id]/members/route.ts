import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { unitMemberProblem } from "@/lib/unitPayer";

export const dynamic = "force-dynamic";

// Adding a member the unit pays for, with what it usually pays for them.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const payer = await prisma.unitPayer.findUnique({ where: { id: params.id } });
  if (!payer) return NextResponse.json({ error: "ไม่พบหน่วยงานนี้" }, { status: 404 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const typed = String(body.memberNumber ?? "").trim();
  const existing = await prisma.unitPayerMember.findMany({
    where: { payerId: payer.id },
    select: { memberNumber: true },
  });
  const problem = unitMemberProblem(typed, existing.map((m) => m.memberNumber));
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // Stored as the roster writes it where the roster knows the member.
  const key = memberNumberKey(typed)!;
  const roster = await prisma.memberRoster.findFirst({
    where: { memberNumber: { in: [typed, key] } },
    select: { memberNumber: true, memberName: true },
  });
  const lastAmount = body.lastAmount === undefined || body.lastAmount === "" ? null : Number(body.lastAmount);
  if (lastAmount !== null && !(lastAmount > 0)) {
    return NextResponse.json({ error: "ยอดต้องมากกว่า 0" }, { status: 400 });
  }
  await prisma.unitPayerMember.create({
    data: { payerId: payer.id, memberNumber: roster?.memberNumber ?? typed, lastAmount },
  });
  await prisma.unitPayer.update({ where: { id: payer.id }, data: { updatedAt: new Date() } });
  return NextResponse.json({ ok: true, inRoster: !!roster, name: roster?.memberName ?? null }, { status: 201 });
}
