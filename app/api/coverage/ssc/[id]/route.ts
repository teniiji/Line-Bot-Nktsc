import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const { count } = await prisma.associationRoster.deleteMany({ where: { id: params.id } });
  if (!count) return NextResponse.json({ error: "ไม่พบรายชื่อ" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Changing what the association pays, without importing the list again.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const benefit = Number(body.benefit);
  if (!Number.isInteger(benefit) || benefit < 0) {
    return NextResponse.json({ error: "เงินสงเคราะห์ต้องเป็นจำนวนเต็มบาทไม่ติดลบ" }, { status: 400 });
  }
  const { count } = await prisma.associationRoster.updateMany({ where: { id: params.id }, data: { benefit } });
  if (!count) return NextResponse.json({ error: "ไม่พบรายชื่อ" }, { status: 404 });
  return NextResponse.json({ ok: true, benefit });
}
