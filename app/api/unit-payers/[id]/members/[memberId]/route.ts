import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function find(params: { id: string; memberId: string }) {
  return prisma.unitPayerMember.findFirst({ where: { id: params.memberId, payerId: params.id } });
}

// The usual amount, which "แบ่งให้หลายคน" starts from.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; memberId: string } }
) {
  const row = await find(params);
  if (!row) return NextResponse.json({ error: "ไม่พบสมาชิกในหน่วยงานนี้" }, { status: 404 });
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const lastAmount = body.lastAmount === null || body.lastAmount === "" ? null : Number(body.lastAmount);
  if (lastAmount !== null && !(lastAmount > 0)) {
    return NextResponse.json({ error: "ยอดต้องมากกว่า 0" }, { status: 400 });
  }
  await prisma.unitPayerMember.update({ where: { id: row.id }, data: { lastAmount } });
  return NextResponse.json({ ok: true });
}

// A member recorded against the wrong unit, or one it no longer pays for.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; memberId: string } }
) {
  const row = await find(params);
  if (!row) return NextResponse.json({ error: "ไม่พบสมาชิกในหน่วยงานนี้" }, { status: 404 });
  await prisma.unitPayerMember.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
}
